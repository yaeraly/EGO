import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import { AlertsService } from '../src/notifications/alerts.service';
import { InventoriesService } from '../src/inventories/inventories.service';
import { SettingKey } from '../src/settings/setting-keys';
import { chooseSample } from '../src/handovers/handover-sample';

describe('Inventory and handover (Module 7, §21, §22)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module4Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule4(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  async function openCount(): Promise<{ id: string; lines: InventoryLine[] }> {
    const { body: document } = await asStaff(http().post('/api/inventories'))
      .send({ warehouse_id: ctx.mainWarehouse, is_full: true })
      .expect(201);
    const { body } = await asStaff(
      http().get(`/api/inventories/${document.id}`),
    ).expect(200);
    return { id: document.id, lines: body.lines };
  }

  interface InventoryLine {
    id: string;
    product_id: string;
    sku: string;
    system_qty: string;
    actual_qty: string;
    diff_qty: string;
  }

  describe('Counting (§22)', () => {
    it('opens a sheet carrying the system figures', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '100.0000' });

      const { lines } = await openCount();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        system_qty: '10.00',
        actual_qty: '10.00',
        diff_qty: '0.00',
      });
    });

    it('computes the difference rather than taking one', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '100.0000' });
      const { id, lines } = await openCount();

      const { body } = await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '8.00' }] })
        .expect(200);

      expect(body.lines[0]).toMatchObject({
        system_qty: '10.00',
        actual_qty: '8.00',
        diff_qty: '-2.00',
      });
      expect(body.shortage_lines).toBe(1);
      expect(body.counted_lines).toBe(1);
    });

    it('refuses to change a confirmed count (§27.1)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { id, lines } = await openCount();
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '5.00' }] })
        .expect(200);
      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Айлык инвентаризация' })
        .expect(201);

      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '4.00' }] })
        .expect(409);
    });
  });

  describe('Adjustment (§22)', () => {
    it('is the OWNER’s alone, and always takes a PIN', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { id } = await openCount();

      await asStaff(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '87654321', reason: 'Мен өзүм' })
        .expect(403);

      const { body } = await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '00000000', reason: 'Туура эмес PIN' })
        .expect(422);
      expect(body.code).toBe('PIN_INVALID');
    });

    it('takes a traced shortage off the named LOT, at that LOT’s cost', async () => {
      const cheap = await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '100.0000',
        date: '2026-08-01',
      });
      const dear = await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '400.0000',
        date: '2026-08-20',
      });

      const { id, lines } = await openCount();
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({
          lines: [
            { line_id: lines[0].id, actual_qty: '8.00', layer_id: dear },
          ],
        })
        .expect(200);

      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Эки мотор жоголду — жооптуу белгиленди' })
        .expect(201);

      // The dear layer lost the two, the cheap one is untouched.
      const stock = await prisma.layer_stock.findMany({
        where: { warehouse_id: ctx.mainWarehouse },
      });
      const byLayer = new Map(stock.map((row) => [row.layer_id, row.qty.toFixed(2)]));
      expect(byLayer.get(dear)).toBe('3.00');
      expect(byLayer.get(cheap)).toBe('5.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'INVENTORY_ADJUSTED' },
      });
      const value = entry.new_value as { shortage_value_kgs: string; in_bonus_base: boolean };
      // 2 × 400.00, not an average of the two layers.
      expect(value.shortage_value_kgs).toBe('800.00');
      expect(value.in_bonus_base).toBe(false);
    });

    it('takes an untraced shortage off the oldest layer, FIFO', async () => {
      const oldest = await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '100.0000',
        date: '2026-08-01',
      });
      await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '400.0000',
        date: '2026-08-20',
      });

      const { id, lines } = await openCount();
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '8.00' }] })
        .expect(200);
      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Кайсы партиядан экени белгисиз' })
        .expect(201);

      const remaining = await prisma.layer_stock.findFirstOrThrow({
        where: { layer_id: oldest },
      });
      expect(remaining.qty.toFixed(2)).toBe('3.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'INVENTORY_ADJUSTED' },
      });
      expect(
        (entry.new_value as { shortage_value_kgs: string }).shortage_value_kgs,
      ).toBe('200.00');
    });

    it('books a surplus as its own layer, at the value the OWNER states', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { id, lines } = await openCount();
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '7.00' }] })
        .expect(200);

      // §22 has the OWNER value it; without a value the confirm refuses.
      const { body } = await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Эки ашыкча табылды' })
        .expect(422);
      expect(body.code).toBe('EXCESS_COST_REQUIRED');

      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({
          pin: '12345678',
          reason: 'Эки ашыкча табылды, наркы акыркы приход боюнча',
          excess_costs: [{ line_id: lines[0].id, unit_cost: '90.0000' }],
        })
        .expect(201);

      const layers = await prisma.fifo_layers.findMany({
        where: { source: 'ADJUSTMENT' },
      });
      expect(layers).toHaveLength(1);
      expect(layers[0].unit_cost.toFixed(4)).toBe('90.0000');
      expect(layers[0].initial_qty.toFixed(2)).toBe('2.00');

      const movements = await prisma.stock_movements.findMany({
        where: { mtype: 'ADJUSTMENT_IN' },
      });
      expect(movements).toHaveLength(1);
    });

    it('leaves stock alone where the count agrees', async () => {
      await stockLayer(app, prisma, ctx, { qty: '6.00', unitCost: '100.0000' });
      const { id, lines } = await openCount();
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '6.00' }] })
        .expect(200);
      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Баары туура' })
        .expect(201);

      const movements = await prisma.stock_movements.findMany({
        where: { mtype: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } },
      });
      expect(movements).toEqual([]);
    });

    it('refuses a shortage the warehouse cannot cover (§42.5)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '100.0000' });
      const { id, lines } = await openCount();
      // Counted as zero after someone else already sold the stock.
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '0.00' }] })
        .expect(200);
      await prisma.layer_stock.updateMany({ data: { qty: '1.00' } });

      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Эки жетишпейт' })
        .expect(409);

      const document = await prisma.documents.findUniqueOrThrow({
        where: { id },
      });
      expect(document.status).toBe('DRAFT');
    });

    it('cannot be confirmed through the generic document endpoint', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { id } = await openCount();
      await asOwner(http().post(`/api/documents/${id}/confirm`)).expect(409);
    });
  });

  describe('The schedule (§22, §39)', () => {
    it('warns about a warehouse that has never been counted', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      // Seeded in production; the test database is truncated, and an unset
      // schedule deliberately raises nothing.
      await prisma.settings.create({
        data: { key: SettingKey.INVENTORY_FULL_COUNT_EVERY_DAYS, value: 30 },
      });

      const digest = await app.get(AlertsService).runDailyDigest();
      expect(digest.inventory_overdue.raised).toBe(true);
      expect(digest.inventory_overdue.warehouses).toBeGreaterThan(0);

      const alerts = await prisma.notifications.findMany({
        where: { kind: 'INVENTORY_OVERDUE' },
      });
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('says nothing while the schedule is unconfigured', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const digest = await app.get(AlertsService).runDailyDigest();
      expect(digest.inventory_overdue).toEqual({ raised: false, warehouses: 0 });
    });

    it('stops warning once a full count is confirmed', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { id, lines } = await openCount();
      await asStaff(http().patch(`/api/inventories/${id}/count`))
        .send({ lines: [{ line_id: lines[0].id, actual_qty: '5.00' }] })
        .expect(200);
      await asOwner(http().post(`/api/inventories/${id}/confirm`))
        .send({ pin: '12345678', reason: 'Айлык инвентаризация' })
        .expect(201);

      const due = await app
        .get(InventoriesService)
        .overdueWarehouses(new Date(), 30);
      expect(due.map((row) => row.warehouseId)).not.toContain(ctx.mainWarehouse);

      // And it is due again once the interval has passed.
      const later = new Date(Date.now() + 31 * 86_400_000);
      const dueLater = await app
        .get(InventoriesService)
        .overdueWarehouses(later, 30);
      expect(dueLater.map((row) => row.warehouseId)).toContain(ctx.mainWarehouse);
    });
  });

  describe('Handover (§21.1)', () => {
    async function openHandover(): Promise<{ id: string; items: HandoverItem[] }> {
      const { body: document } = await asOwner(http().post('/api/handovers'))
        .send({ to_user: ctx.staffId, warehouse_id: ctx.mainWarehouse })
        .expect(201);
      const { body } = await asOwner(
        http().get(`/api/handovers/${document.id}`),
      ).expect(200);
      return { id: document.id, items: body.handover_checked_items };
    }

    interface HandoverItem {
      id: string;
      product_id: string;
      is_a_class: boolean;
      system_qty: string;
      actual_qty: string;
    }

    it('counts every A-class product in full, plus a sample the system picks', () => {
      const held = Array.from({ length: 30 }, (_, i) => ({
        productId: `p${i}`,
        categoryId: i < 3 ? 'motors' : 'other',
      }));

      const sample = chooseSample({
        held,
        aClassCategories: ['motors'],
        randomPositions: 12,
        random: () => 0.5,
      });

      expect(sample.filter((item) => item.isAClass)).toHaveLength(3);
      expect(sample.filter((item) => !item.isAClass)).toHaveLength(12);
      // Never the same product twice, whatever the draw.
      expect(new Set(sample.map((item) => item.productId)).size).toBe(15);
    });

    it('moves responsibility only once both have signed (§21.1)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '100.0000' });
      const { id, items } = await openHandover();
      expect(items.length).toBeGreaterThan(0);

      await asOwner(http().post(`/api/handovers/${id}/sign`)).send({}).expect(201);
      const half = await prisma.documents.findUniqueOrThrow({ where: { id } });
      expect(half.status).toBe('DRAFT');

      await asStaff(http().post(`/api/handovers/${id}/sign`)).send({}).expect(201);
      const done = await prisma.documents.findUniqueOrThrow({ where: { id } });
      expect(done.status).toBe('CONFIRMED');
    });

    it('records what it found and corrects nothing (§21.1, §22)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '100.0000' });
      const { id, items } = await openHandover();

      await asOwner(http().patch(`/api/handovers/${id}/count`))
        .send({ items: [{ item_id: items[0].id, actual_qty: '9.00' }] })
        .expect(200);

      await asOwner(http().post(`/api/handovers/${id}/sign`)).send({}).expect(201);
      await asStaff(http().post(`/api/handovers/${id}/sign`)).send({}).expect(201);

      const act = await prisma.handover_acts.findUniqueOrThrow({
        where: { document_id: id },
      });
      expect(act.difference.toFixed(2)).toBe('-1.00');

      // The shelf still says ten: a handover reports, §22 corrects.
      const stock = await prisma.layer_stock.findFirstOrThrow();
      expect(stock.qty.toFixed(2)).toBe('10.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'HANDOVER_COMPLETED' },
      });
      expect(
        (entry.new_value as { difference_qty: string }).difference_qty,
      ).toBe('-1.00');
    });

    it('lets nobody outside the act sign or count it', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { body: document } = await asOwner(http().post('/api/handovers'))
        .send({ to_user: ctx.ownerId, warehouse_id: ctx.mainWarehouse })
        .expect(400);
      expect(JSON.stringify(document.message)).toContain('өзүнө');
    });

    it('refuses figures once someone has signed', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const { id, items } = await openHandover();
      await asOwner(http().post(`/api/handovers/${id}/sign`)).send({}).expect(201);

      await asOwner(http().patch(`/api/handovers/${id}/count`))
        .send({ items: [{ item_id: items[0].id, actual_qty: '1.00' }] })
        .expect(409);
    });
  });
});
