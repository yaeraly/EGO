import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, fifo_layer_source } from '@prisma/client';
import request from 'supertest';
import { BusinessDaysService } from '../src/business-days/business-days.service';
import { StockService } from '../src/stock/stock.service';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module3Context, resetModule3 } from './module3-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Warehouse transfers (Module 3.3, §12-А.4–5)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stock: StockService;
  let businessDays: BusinessDaysService;
  let ctx: Module3Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    stock = app.get(StockService);
    businessDays = app.get(BusinessDaysService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule3(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const flow = () => documentFlow(app, ctx.ownerToken);

  async function stockedLayer(
    qty = '10.00',
    unitCost = '7500.0000',
  ): Promise<string> {
    const { body: purchase } = await asOwner(http().post('/api/purchases'))
      .send({
        supplier_id: ctx.supplierId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00', price_cny: '1.00' }],
      })
      .expect(201);

    const layer = await prisma.$transaction((tx) =>
      stock.createLayer(tx, {
        productId: ctx.productIds[0],
        source: fifo_layer_source.PURCHASE,
        layerDate: new Date('2026-08-01T00:00:00Z'),
        unitCost: D(unitCost),
        qty: D(qty),
        warehouseId: ctx.mainWarehouse,
        documentId: purchase.id,
      }),
    );
    return layer.id;
  }

  const onHand = (layerId: string, warehouseId: string) =>
    stock.onHand(prisma, layerId, warehouseId).then((q) => q.toFixed(2));

  describe('the cost does not change in transit (§12-А.5)', () => {
    it('MAIN → SERVICE keeps the same layer and the same unit cost', async () => {
      const layerId = await stockedLayer('10.00', '7500.0000');

      const { id } = await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.serviceWarehouse,
        items: [{ layer_id: layerId, qty: '4.00' }],
      });
      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(201);

      // Same layer on both sides — a transfer is not a purchase.
      expect(await onHand(layerId, ctx.mainWarehouse)).toBe('6.00');
      expect(await onHand(layerId, ctx.serviceWarehouse)).toBe('4.00');

      const layer = await prisma.fifo_layers.findUnique({ where: { id: layerId } });
      expect(layer!.unit_cost.toFixed(4)).toBe('7500.0000');

      const movements = await prisma.stock_movements.findMany({
        where: { document_id: id },
        orderBy: { id: 'asc' },
      });
      expect(movements.map((m) => m.mtype)).toEqual([
        'TRANSFER_OUT',
        'TRANSFER_IN',
      ]);
      for (const movement of movements) {
        expect(movement.unit_cost.toFixed(4)).toBe('7500.0000');
      }
    });

    it('MAIN → DEFECT keeps the cost too (§12-А.6)', async () => {
      const layerId = await stockedLayer('10.00', '7500.0000');

      const { id } = await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.defectWarehouse,
        items: [{ layer_id: layerId, qty: '2.00' }],
      });
      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(201);

      const [entry] = await stock.stockByProduct({ productId: ctx.productIds[0] });
      expect(entry.current_qty).toBe('10.00');
      // The two in DEFECT are no longer for sale, but still worth 7 500 each.
      expect(entry.available_qty).toBe('8.00');
      expect(entry.total_value_kgs).toBe('75000.00');
    });

    it('records the unit cost on the line for the record', async () => {
      const layerId = await stockedLayer('10.00', '1234.5600');
      const { body: draft } = await asOwner(
        http().post('/api/warehouse-transfers'),
      )
        .send({
          from_warehouse: ctx.mainWarehouse,
          to_warehouse: ctx.serviceWarehouse,
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(201);

      const items = await prisma.warehouse_transfer_items.findMany({
        where: { transfer_id: draft.id },
      });
      expect(items[0].unit_cost.toFixed(4)).toBe('1234.5600');
    });
  });

  describe('the two steps (§12-А.4)', () => {
    it('sending takes goods out; nothing arrives until they are received', async () => {
      const layerId = await stockedLayer('10.00', '100.0000');

      const { id } = await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.serviceWarehouse,
        items: [{ layer_id: layerId, qty: '3.00' }],
      });

      expect(await onHand(layerId, ctx.mainWarehouse)).toBe('7.00');
      expect(await onHand(layerId, ctx.serviceWarehouse)).toBe('0.00');

      const { body } = await asOwner(
        http().get(`/api/warehouse-transfers/${id}`),
      ).expect(200);
      expect(body.tstatus).toBe('SENT');

      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(201);
      expect(await onHand(layerId, ctx.serviceWarehouse)).toBe('3.00');
    });

    it('refuses to receive a transfer that was never sent', async () => {
      const layerId = await stockedLayer();
      const { body: draft } = await asOwner(
        http().post('/api/warehouse-transfers'),
      )
        .send({
          from_warehouse: ctx.mainWarehouse,
          to_warehouse: ctx.serviceWarehouse,
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(201);

      await asOwner(
        http().post(`/api/warehouse-transfers/${draft.id}/receive`),
      ).expect(409);
    });

    it('refuses to receive the same transfer twice', async () => {
      const layerId = await stockedLayer();
      const { id } = await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.serviceWarehouse,
        items: [{ layer_id: layerId, qty: '2.00' }],
      });

      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(201);
      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(409);
      expect(await onHand(layerId, ctx.serviceWarehouse)).toBe('2.00');
    });

    it('refuses more than the origin holds, leaving nothing behind', async () => {
      const layerId = await stockedLayer('5.00', '100.0000');

      const { body: draft } = await asOwner(
        http().post('/api/warehouse-transfers'),
      )
        .send({
          from_warehouse: ctx.mainWarehouse,
          to_warehouse: ctx.serviceWarehouse,
          items: [{ layer_id: layerId, qty: '9.00' }],
        });
      // Refused while still a draft, before anything is promised.
      expect(draft.message).toMatch(/not 9\.00|holds/);

      expect(await onHand(layerId, ctx.mainWarehouse)).toBe('5.00');
    });

    it('refuses a transfer to the same warehouse', async () => {
      const layerId = await stockedLayer();
      await asOwner(http().post('/api/warehouse-transfers'))
        .send({
          from_warehouse: ctx.mainWarehouse,
          to_warehouse: ctx.mainWarehouse,
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(400);
    });

    it('refuses an inactive destination (§12-А.8.7)', async () => {
      const layerId = await stockedLayer();
      const { body: temp } = await asOwner(http().post('/api/warehouses'))
        .send({ code: 'TMP', name: 'Убактылуу', wtype: 'OTHER' })
        .expect(201);
      await asOwner(http().patch(`/api/warehouses/${temp.id}`))
        .send({ is_active: false })
        .expect(200);

      await asOwner(http().post('/api/warehouse-transfers'))
        .send({
          from_warehouse: ctx.mainWarehouse,
          to_warehouse: temp.id,
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(409);
    });

    it('moves several layers in one document', async () => {
      const first = await stockedLayer('10.00', '7000.0000');
      const second = await stockedLayer('10.00', '8000.0000');

      const { id } = await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.serviceWarehouse,
        items: [
          { layer_id: first, qty: '2.00' },
          { layer_id: second, qty: '3.00' },
        ],
      });
      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(201);

      expect(await onHand(first, ctx.serviceWarehouse)).toBe('2.00');
      expect(await onHand(second, ctx.serviceWarehouse)).toBe('3.00');

      // Each keeps its own cost — nothing is averaged (§18).
      const [entry] = await stock.stockByProduct({ productId: ctx.productIds[0] });
      const service = entry.by_warehouse.find((w) => w.code === 'SERVICE')!;
      expect(service.value_kgs).toBe('38000.00');
    });
  });

  describe('an unreceived transfer blocks the day close', () => {
    it('appears in the blocker list while it is in flight', async () => {
      const layerId = await stockedLayer();
      const { id, doc_number } = await flow().createAndConfirm(
        '/api/warehouse-transfers',
        {
          from_warehouse: ctx.mainWarehouse,
          to_warehouse: ctx.serviceWarehouse,
          items: [{ layer_id: layerId, qty: '1.00' }],
        },
      );

      // Drafts of any kind block the day too (Period Lock); what this test
      // is about is the transfer's own unfinished state.
      const blockers = await businessDays.dayCloseBlockers(new Date());
      expect(blockers).toContainEqual(
        expect.objectContaining({
          kind: 'TRANSFER_IN_FLIGHT',
          document_id: id,
          doc_number,
        }),
      );

      const { body } = await asOwner(
        http().get('/api/warehouse-transfers/in-flight'),
      ).expect(200);
      expect(body).toHaveLength(1);
    });

    it('stops blocking once it is received', async () => {
      const layerId = await stockedLayer();
      const { id } = await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.serviceWarehouse,
        items: [{ layer_id: layerId, qty: '1.00' }],
      });

      await asOwner(http().post(`/api/warehouse-transfers/${id}/receive`)).expect(201);

      const blockers = await businessDays.dayCloseBlockers(new Date());
      expect(
        blockers.filter((blocker) => blocker.kind === 'TRANSFER_IN_FLIGHT'),
      ).toEqual([]);
    });

    it('does not block a day that ended before it was sent', async () => {
      const layerId = await stockedLayer();
      await flow().createAndConfirm('/api/warehouse-transfers', {
        from_warehouse: ctx.mainWarehouse,
        to_warehouse: ctx.serviceWarehouse,
        items: [{ layer_id: layerId, qty: '1.00' }],
      });

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      expect(await businessDays.dayCloseBlockers(yesterday)).toEqual([]);
    });
  });
});
