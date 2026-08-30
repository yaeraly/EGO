import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, purchase_status } from '@prisma/client';
import request from 'supertest';
import { LOGISTICS_SEQUENCE } from '../src/purchases/logistics-status';
import { createTestApp } from './app-harness';
import {
  Module2Context,
  buyCurrency,
  documentFlow,
  resetModule2,
} from './module2-harness';

describe('Purchases (Module 2.2 and 2.3)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module2Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule2(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const lines = (...specs: [number, string, string][]) =>
    specs.map(([index, qty, price]) => ({
      product_id: ctx.productIds[index],
      qty,
      price_cny: price,
    }));

  const draftPurchase = (items = lines([0, '100.00', '1000.00'])) =>
    asOwner(http().post('/api/purchases')).send({
      supplier_id: ctx.supplierId,
      cargo_company_id: ctx.cargoCompanyId,
      items,
    });

  /** A confirmed purchase needs a CNY reference rate to exist (§10.1). */
  async function withReferenceRate(rate = '13.00'): Promise<void> {
    await buyCurrency(app, ctx, {
      kgs: new Prisma.Decimal(rate).times(1000).toFixed(2),
      foreign: '1000.00',
      toAccount: ctx.cnyAccount,
    });
  }

  async function confirmedPurchase(
    items = lines([0, '100.00', '1000.00']),
  ): Promise<string> {
    await withReferenceRate();
    const { body } = await draftPurchase(items).expect(201);
    await asOwner(http().post(`/api/documents/${body.id}/confirm`)).expect(201);
    return body.id as string;
  }

  describe('creating an order (§4.1)', () => {
    it('creates a PUR draft with its lines', async () => {
      const res = await draftPurchase().expect(201);

      expect(res.body.doc_number).toMatch(/^PUR-\d{4}-\d{6}$/);
      expect(res.body.status).toBe('DRAFT');

      const purchase = await prisma.purchases.findUnique({
        where: { document_id: res.body.id },
        include: { purchase_items: true },
      });
      expect(purchase?.supplier_id).toBe(ctx.supplierId);
      expect(purchase?.cargo_company_id).toBe(ctx.cargoCompanyId);
      expect(purchase?.purchase_items).toHaveLength(1);
      expect(purchase?.logistics_status).toBe(purchase_status.DRAFT);
    });

    it('totals the order in CNY', async () => {
      const { body } = await draftPurchase(
        lines([0, '100.00', '1000.00'], [1, '20.00', '2500.50']),
      ).expect(201);

      const res = await asOwner(
        http().get(`/api/purchases/${body.id}`),
      ).expect(200);

      const total = res.body.purchase_items.reduce(
        (sum: Prisma.Decimal, item: { qty: string; price_cny: string }) =>
          sum.plus(new Prisma.Decimal(item.qty).times(item.price_cny)),
        new Prisma.Decimal(0),
      );
      // 100 x 1000.00 + 20 x 2500.50
      expect(total.toFixed(2)).toBe('150010.00');
    });

    it('lets a salesperson read but not create (§4.1)', async () => {
      await draftPurchase().expect(201);

      await asStaff(http().get('/api/purchases')).expect(200);
      await asStaff(http().post('/api/purchases'))
        .send({ supplier_id: ctx.supplierId, items: lines([0, '1.00', '1.00']) })
        .expect(403);
    });

    it.each([
      ['no lines', []],
      ['zero quantity', [{ qty: '0.00' }]],
      ['negative price', [{ price_cny: '-1.00' }]],
    ])('refuses %s', async (_label, overrides) => {
      const items = overrides.length
        ? overrides.map((o) => ({ ...lines([0, '1.00', '1.00'])[0], ...o }))
        : [];

      await asOwner(http().post('/api/purchases'))
        .send({ supplier_id: ctx.supplierId, items })
        .expect(400);
    });

    it('refuses an unknown product', async () => {
      await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          items: [
            {
              product_id: '00000000-0000-0000-0000-000000000000',
              qty: '1.00',
              price_cny: '1.00',
            },
          ],
        })
        .expect(404);
    });

    it('refuses an inactive product', async () => {
      await asOwner(http().patch(`/api/products/${ctx.productIds[0]}`))
        .send({ is_active: false })
        .expect(200);

      await draftPurchase().expect(409);
    });

    it('refuses a JSON number for a price', async () => {
      await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00', price_cny: 1000 }],
        })
        .expect(400);
    });
  });

  describe('lines are editable only while the order is a draft (§27.1)', () => {
    it('replaces lines on a draft', async () => {
      const { body } = await draftPurchase().expect(201);

      const res = await asOwner(http().patch(`/api/purchases/${body.id}/items`))
        .send({ items: lines([1, '5.00', '3000.00']) })
        .expect(200);

      expect(res.body.purchase_items).toHaveLength(1);
    });

    it('refuses to change a confirmed order', async () => {
      const id = await confirmedPurchase();

      await asOwner(http().patch(`/api/purchases/${id}/items`))
        .send({ items: lines([1, '5.00', '3000.00']) })
        .expect(409);

      const rejected = await prisma.audit_log.findFirst({
        where: { action: 'DOCUMENT_UPDATE_REJECTED' },
      });
      expect(rejected?.reason).toContain('REPLACE_ITEMS');
    });

    it('refuses to confirm an order with no lines', async () => {
      await withReferenceRate();
      const { body } = await draftPurchase().expect(201);
      await prisma.purchase_items.deleteMany({ where: { purchase_id: body.id } });

      await asOwner(http().post(`/api/documents/${body.id}/confirm`)).expect(400);
    });
  });

  describe('the 16 logistics stages (§6)', () => {
    it('matches the enum, in order', () => {
      expect(LOGISTICS_SEQUENCE).toHaveLength(16);
      expect(new Set(LOGISTICS_SEQUENCE).size).toBe(16);
      expect(Object.values(purchase_status).sort()).toEqual(
        [...LOGISTICS_SEQUENCE].sort(),
      );
    });

    it('is served to the UI in order', async () => {
      const res = await asOwner(
        http().get('/api/purchases/logistics-stages'),
      ).expect(200);

      expect(res.body).toHaveLength(16);
      expect(res.body[0]).toEqual({ stage: 1, status: 'DRAFT' });
      expect(res.body[15]).toEqual({ stage: 16, status: 'CLOSED' });
    });

    it('will not move an unconfirmed order along', async () => {
      const { body } = await draftPurchase().expect(201);

      await asOwner(http().post(`/api/purchases/${body.id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(409);
    });

    it('lets a salesperson take the next step', async () => {
      const id = await confirmedPurchase();

      const res = await asStaff(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);

      expect(res.body.purchase.logistics_status).toBe('SENT_TO_SUPPLIER');
    });

    // Criterion 4: an ordinary employee cannot skip stages.
    it('refuses a salesperson skipping stages', async () => {
      const id = await confirmedPurchase();

      const res = await asStaff(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'IN_TRANSIT' })
        .expect(403);

      expect(res.body.message).toContain('SENT_TO_SUPPLIER');
      const stored = await prisma.purchases.findUnique({
        where: { document_id: id },
      });
      expect(stored?.logistics_status).toBe('DRAFT');
    });

    it('refuses a salesperson moving backwards', async () => {
      const id = await confirmedPurchase();
      await asStaff(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);

      await asStaff(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'DRAFT' })
        .expect(403);
    });

    // Criterion 4: an OWNER jump is recorded in the Audit Log.
    it('lets the OWNER jump, and records it', async () => {
      const id = await confirmedPurchase();

      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'ARRIVED_SVH', reason: 'carrier reported late' })
        .expect(201);

      const jump = await prisma.audit_log.findFirst({
        where: { action: 'PURCHASE_STATUS_JUMPED' },
      });
      expect(jump).not.toBeNull();
      expect(jump?.old_value).toMatchObject({ status: 'DRAFT', stage: 1 });
      expect(jump?.new_value).toMatchObject({ status: 'ARRIVED_SVH', stage: 10 });
      expect(jump?.reason).toBe('carrier reported late');
    });

    it('does not audit an ordinary one-step move — history already has it', async () => {
      const id = await confirmedPurchase();

      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);

      expect(
        await prisma.audit_log.count({
          where: { action: 'PURCHASE_STATUS_JUMPED' },
        }),
      ).toBe(0);
    });

    // Criterion 4: every change lands in the history.
    it('records every change, with who and when', async () => {
      const id = await confirmedPurchase();
      for (const status of [
        'SENT_TO_SUPPLIER',
        'SUPPLIER_ACCEPTED',
        'COLLECTING',
      ]) {
        await asOwner(http().post(`/api/purchases/${id}/status`))
          .send({ status })
          .expect(201);
      }

      const history = await prisma.purchase_status_history.findMany({
        where: { purchase_id: id },
        orderBy: { id: 'asc' },
      });

      // The confirmation seeds the starting stage, then three moves.
      expect(history.map((h) => h.status)).toEqual([
        'DRAFT',
        'SENT_TO_SUPPLIER',
        'SUPPLIER_ACCEPTED',
        'COLLECTING',
      ]);
      expect(history.every((h) => h.user_id === ctx.ownerId)).toBe(true);
      expect(history.every((h) => h.at instanceof Date)).toBe(true);
    });

    it('refuses a move to the stage it is already at', async () => {
      const id = await confirmedPurchase();

      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'DRAFT' })
        .expect(409);
    });

    it('reports the days spent at each stage and the lead time', async () => {
      const id = await confirmedPurchase();
      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);

      // Backdate the first entry to exactly five days before the second, so
      // the gap is five days to the millisecond rather than five days minus
      // however long the two requests took.
      const [first, second] = await prisma.purchase_status_history.findMany({
        where: { purchase_id: id },
        orderBy: { id: 'asc' },
      });
      await prisma.purchase_status_history.update({
        where: { id: first.id },
        data: { at: new Date(second.at.getTime() - 5 * 24 * 60 * 60 * 1000) },
      });

      const res = await asOwner(
        http().get(`/api/purchases/${id}/status-history`),
      ).expect(200);

      expect(res.body.history).toHaveLength(2);
      expect(res.body.history[0].days).toBe(5);
      expect(res.body.history[0].stage).toBe(1);
      expect(res.body.history[1].stage).toBe(2);
      // The purchase is still at the last stage, so it has no duration yet.
      expect(res.body.history[1].days).toBeNull();
      expect(res.body.lead_time_days).toBe(5);
    });
  });

  describe('logistics and payment are independent (§6)', () => {
    it('moves through every stage with nothing paid', async () => {
      const id = await confirmedPurchase();

      for (const status of LOGISTICS_SEQUENCE.slice(1)) {
        await asOwner(http().post(`/api/purchases/${id}/status`))
          .send({ status })
          .expect(201);
      }

      const stored = await prisma.purchases.findUnique({
        where: { document_id: id },
      });
      expect(stored?.logistics_status).toBe('CLOSED');

      // Still fully unpaid: the debt is untouched by where the goods are.
      const balance = await prisma.supplier_ledger.aggregate({
        where: { supplier_id: ctx.supplierId },
        _sum: { amount_cny: true },
      });
      expect(balance._sum.amount_cny?.toFixed(2)).toBe('-100000.00');
    });
  });
});
