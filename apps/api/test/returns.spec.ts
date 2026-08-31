import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';

describe('Return (Module 8, §35, §36-А.2)', () => {
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
    await prisma.products.update({
      where: { id: ctx.productIds[0] },
      data: { base_markup_pct: '50.00' },
    });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  /** A confirmed sale of `qty` at a cost of `unitCost`, paid in cash. */
  async function sell(params: {
    qty: string;
    unitCost?: string;
    paid?: string;
    dueDate?: string;
  }): Promise<{ saleId: string; itemId: string; total: Prisma.Decimal }> {
    await stockLayer(app, prisma, ctx, {
      qty: params.qty,
      unitCost: params.unitCost ?? '100.0000',
    });

    const price = new Prisma.Decimal(params.unitCost ?? '100.0000').times(1.5);
    const total = price.times(params.qty).toDecimalPlaces(2);
    const paid = params.paid ?? total.toFixed(2);

    const { body: sale } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.customerId,
        items: [{ product_id: ctx.productIds[0], qty: params.qty }],
        ...(new Prisma.Decimal(paid).greaterThan(0)
          ? { payments: [{ account_id: ctx.sellerCash, amount: paid }] }
          : {}),
        ...(params.dueDate ? { debt_due_date: params.dueDate } : {}),
      })
      .expect(201);

    await asStaff(http().post(`/api/sales/${sale.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);

    const items = await prisma.sale_items.findMany({
      where: { sale_id: sale.id },
    });
    return { saleId: sale.id, itemId: items[0].id, total };
  }

  async function draftReturn(params: {
    saleId: string;
    itemId: string;
    qty: string;
    condition?: 'RESALABLE' | 'DEFECT';
  }): Promise<string> {
    const { body } = await asStaff(http().post('/api/returns'))
      .send({
        original_sale: params.saleId,
        reason: 'Кардар кайтарды',
        items: [
          {
            sale_item_id: params.itemId,
            qty: params.qty,
            condition: params.condition ?? 'RESALABLE',
          },
        ],
      })
      .expect(201);
    return body.id as string;
  }

  describe('§35.1 — a return always names its sale', () => {
    it('refuses a line that is not on the sale', async () => {
      const { saleId } = await sell({ qty: '5.00' });
      const other = await sell({ qty: '1.00' });

      await asStaff(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Жаңылыш',
          items: [
            { sale_item_id: other.itemId, qty: '1.00', condition: 'RESALABLE' },
          ],
        })
        .expect(404);
    });

    it('refuses to return more than was sold, counting earlier returns (§35.7)', async () => {
      const { saleId, itemId } = await sell({ qty: '3.00' });

      const first = await draftReturn({ saleId, itemId, qty: '2.00' });
      await asStaff(http().post(`/api/returns/${first}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '300.00' }],
        })
        .expect(201);

      await asStaff(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Дагы экөө',
          items: [{ sale_item_id: itemId, qty: '2.00', condition: 'RESALABLE' }],
        })
        .expect(409);
    });
  });

  describe('§18.0 — the goods come back at the cost they left at', () => {
    it('creates a new layer dated today, at the original cost', async () => {
      const { saleId, itemId } = await sell({ qty: '2.00', unitCost: '7000.0000' });

      // A later, dearer batch arrives; it must not change what comes back.
      await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '9000.0000',
        date: '2026-08-25',
      });

      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });
      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '10500.00' }],
        })
        .expect(201);

      const layers = await prisma.fifo_layers.findMany({
        where: { source: 'RETURN' },
      });
      expect(layers).toHaveLength(1);
      expect(layers[0].unit_cost.toFixed(4)).toBe('7000.0000');
      expect(layers[0].initial_qty.toFixed(2)).toBe('1.00');

      // The old layer is not refilled: it kept the one unit it had left.
      const purchase = await prisma.fifo_layers.findFirstOrThrow({
        where: { source: 'PURCHASE', unit_cost: '7000.0000' },
      });
      const stock = await prisma.layer_stock.findUniqueOrThrow({
        where: {
          layer_id_warehouse_id: {
            layer_id: purchase.id,
            warehouse_id: ctx.mainWarehouse,
          },
        },
      });
      expect(stock.qty.toFixed(2)).toBe('0.00');

      const movement = await prisma.stock_movements.findFirstOrThrow({
        where: { mtype: 'RETURN_IN' },
      });
      expect(movement.qty.toFixed(2)).toBe('1.00');
    });

    it('sends a defective item to DEFECT, never to MAIN (§42.12)', async () => {
      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({
        saleId,
        itemId,
        qty: '1.00',
        condition: 'DEFECT',
      });

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(201);

      const layer = await prisma.fifo_layers.findFirstOrThrow({
        where: { source: 'RETURN' },
      });
      const stock = await prisma.layer_stock.findFirstOrThrow({
        where: { layer_id: layer.id },
      });
      expect(stock.warehouse_id).toBe(ctx.defectWarehouse);
    });
  });

  describe('§35.4 — the debt is settled before any cash moves', () => {
    it('closes the open debt first and refunds only the remainder', async () => {
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '50000.00' },
      });

      // Sold 10 at 150.00 = 1 500.00, of which 500.00 was paid.
      const { saleId, itemId } = await sell({
        qty: '10.00',
        paid: '500.00',
        dueDate: '2026-12-31',
      });

      const owed = await prisma.sales.findUniqueOrThrow({
        where: { document_id: saleId },
      });
      expect(owed.outstanding_amount.toFixed(2)).toBe('1000.00');

      // Returning 9 = 1 350.00: 1 000.00 clears the debt, 350.00 in cash.
      const returnId = await draftReturn({ saleId, itemId, qty: '9.00' });
      const { body } = await asStaff(
        http().post(`/api/returns/${returnId}/confirm`),
      )
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '350.00' }],
        })
        .expect(201);

      expect(body.debt_offset).toBe('1000.00');
      expect(body.cash_refund).toBe('350.00');

      const settled = await prisma.sales.findUniqueOrThrow({
        where: { document_id: saleId },
      });
      expect(settled.outstanding_amount.toFixed(2)).toBe('0.00');
    });

    it('refuses a cash figure that does not match what is left over', async () => {
      const { saleId, itemId } = await sell({ qty: '2.00' });
      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });

      const { body } = await asStaff(
        http().post(`/api/returns/${returnId}/confirm`),
      )
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '100.00' }],
        })
        .expect(422);
      expect(body.code).toBe('REFUND_AMOUNT_MISMATCH');
      expect(body.cash_refund).toBe('150.00');
    });
  });

  describe('§35.5 — where the money comes from is documented', () => {
    it('takes it from the account that was paid, without a reason', async () => {
      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(201);

      const lines = await prisma.refund_lines.findMany({
        where: { return_id: returnId },
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].source_override_reason).toBeNull();

      const movements = await prisma.account_movements.findMany({
        where: { document_id: returnId },
      });
      expect(movements[0].amount.toFixed(2)).toBe('-150.00');
    });

    it('needs a reason to pay out of another account', async () => {
      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });

      const { body } = await asStaff(
        http().post(`/api/returns/${returnId}/confirm`),
      )
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.ownerCash, amount: '150.00' }],
        })
        .expect(422);
      expect(body.code).toBe('REFUND_SOURCE_OVERRIDE_REASON_REQUIRED');

      // §35.6's real case: the seller's till is empty, so the money has to
      // come from somewhere else — moved there openly, by its own TRN (§35.6).
      const { body: transfer } = await asOwner(http().post('/api/transfers'))
        .send({
          from_account: ctx.sellerCash,
          to_account: ctx.ownerCash,
          amount: '150.00',
        })
        .expect(201);
      await asOwner(
        http().post(`/api/documents/${transfer.id}/confirm`),
      ).expect(201);

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.ownerCash, amount: '150.00' }],
          source_override_reason: 'Сатуучунун кассасында акча жок эле',
        })
        .expect(201);

      const lines = await prisma.refund_lines.findMany({
        where: { return_id: returnId },
      });
      expect(lines[0].source_override_reason).toContain('акча жок');
    });

    it('refuses to overdraw the till (§35.6, §42.5)', async () => {
      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });

      // Empty the till between the sale and the refund.
      await prisma.account_movements.deleteMany({
        where: { account_id: ctx.sellerCash },
      });

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(409);

      const document = await prisma.documents.findUniqueOrThrow({
        where: { id: returnId },
      });
      expect(document.status).toBe('DRAFT');
    });
  });

  describe('Security and §36-А.2', () => {
    it('always takes a PIN', async () => {
      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });

      const { body } = await asStaff(
        http().post(`/api/returns/${returnId}/confirm`),
      )
        .send({
          pin: '00000000',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(422);
      expect(body.code).toBe('PIN_INVALID');
    });

    it('lets a defective return through while the warranty runs', async () => {
      const category = await prisma.product_categories.create({
        data: { name: 'Моторлор', default_warranty_days: 30 },
      });
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { category_id: category.id, warranty_days: null },
      });

      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({
        saleId,
        itemId,
        qty: '1.00',
        condition: 'DEFECT',
      });

      const item = await prisma.return_items.findFirstOrThrow({
        where: { return_id: returnId },
      });
      expect(item.warranty_ok).toBe(true);

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(201);
    });

    it('stops a salesperson once the warranty has run out, and takes the OWNER’s reason', async () => {
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { warranty_days: 0 },
      });

      const { saleId, itemId } = await sell({ qty: '1.00' });
      // Sold yesterday, warranty of zero days: today is already too late.
      await prisma.documents.update({
        where: { id: saleId },
        data: { business_date: new Date(Date.now() - 2 * 86_400_000) },
      });

      const returnId = await draftReturn({
        saleId,
        itemId,
        qty: '1.00',
        condition: 'DEFECT',
      });
      const item = await prisma.return_items.findFirstOrThrow({
        where: { return_id: returnId },
      });
      expect(item.warranty_ok).toBe(false);

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(403);

      const { body } = await asOwner(
        http().post(`/api/returns/${returnId}/confirm`),
      )
        .send({
          pin: '12345678',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(422);
      expect(body.code).toBe('WARRANTY_EXPIRED');

      await asOwner(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '12345678',
          refunds: [{ account_id: ctx.sellerCash, amount: '150.00' }],
          warranty_exception_reason: 'Заводдук брак, поставщикке талап коюлат',
        })
        .expect(201);

      const settled = await prisma.return_items.findFirstOrThrow({
        where: { return_id: returnId },
      });
      expect(settled.owner_exception_reason).toContain('Заводдук брак');
    });

    it('cannot be confirmed through the generic document endpoint', async () => {
      const { saleId, itemId } = await sell({ qty: '1.00' });
      const returnId = await draftReturn({ saleId, itemId, qty: '1.00' });
      await asOwner(http().post(`/api/documents/${returnId}/confirm`)).expect(409);
    });
  });

  describe('§35.8 — what the reports have to move by', () => {
    it('records the revenue and cost it reversed, and marks the sale line', async () => {
      const { saleId, itemId } = await sell({ qty: '4.00', unitCost: '100.0000' });
      const returnId = await draftReturn({ saleId, itemId, qty: '2.00' });

      await asStaff(http().post(`/api/returns/${returnId}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '300.00' }],
        })
        .expect(201);

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'RETURN_CONFIRMED' },
      });
      expect(entry.new_value).toMatchObject({
        revenue_reversed: '300.00',
        cogs_reversed: '200.00',
        debt_offset: '0.00',
        cash_refund: '300.00',
      });

      const line = await prisma.sale_items.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(line.returned_qty.toFixed(2)).toBe('2.00');
      // §35.1.2 — the sale itself is untouched.
      expect(line.qty.toFixed(2)).toBe('4.00');
      expect(line.final_price.toFixed(2)).toBe('150.00');
    });
  });
});
