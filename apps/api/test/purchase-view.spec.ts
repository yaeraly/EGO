import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import {
  Module2Context,
  buyCurrency,
  documentFlow,
  resetModule2,
  shipPurchase,
} from './module2-harness';

describe('Purchase board (Module 2.4 and 2.8 read model)', () => {
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

  /** 1000 CNY at 13.00 into the CNY till, so a payable can be recognised. */
  async function withYuan(cny = '3000.00', rate = '13.00'): Promise<void> {
    await buyCurrency(app, ctx, {
      kgs: new Prisma.Decimal(rate).times(cny).toFixed(2),
      foreign: cny,
      toAccount: ctx.cnyAccount,
    });
  }

  async function confirmedPurchase(
    items: { product_id: string; qty: string; price_cny: string }[],
  ): Promise<string> {
    const flow = documentFlow(app, ctx.ownerToken);
    const { id } = await flow.createAndConfirm('/api/purchases', {
      supplier_id: ctx.supplierId,
      cargo_company_id: ctx.cargoCompanyId,
      items,
    });
    return id;
  }

  async function payTowards(
    purchaseId: string | null,
    amountCny: string,
  ): Promise<string> {
    const flow = documentFlow(app, ctx.ownerToken);
    const { id } = await flow.createAndConfirm('/api/supplier-payments', {
      supplier_id: ctx.supplierId,
      from_account: ctx.cnyAccount,
      amount_cny: amountCny,
      ...(purchaseId ? { purchase_id: purchaseId } : {}),
    });
    return id;
  }

  const oneLine = (qty: string, price: string) => [
    { product_id: ctx.productIds[0], qty, price_cny: price },
  ];

  describe('payment status (§4.2)', () => {
    it('is UNPAID for a confirmed order with no payments', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.total_cny).toBe('1000.00');
      expect(body.totals.paid_cny).toBe('0.00');
      expect(body.totals.outstanding_cny).toBe('1000.00');
      expect(body.totals.payment_status).toBe('UNPAID');
    });

    it('is PARTIALLY_PAID once some of it is paid', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      await payTowards(id, '400.00');

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.paid_cny).toBe('400.00');
      expect(body.totals.outstanding_cny).toBe('600.00');
      expect(body.totals.payment_status).toBe('PARTIALLY_PAID');
    });

    it('is PAID once the whole order is covered', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      await payTowards(id, '600.00');
      await payTowards(id, '400.00');

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.paid_cny).toBe('1000.00');
      expect(body.totals.outstanding_cny).toBe('0.00');
      expect(body.totals.payment_status).toBe('PAID');
    });

    it('never reports a negative outstanding amount when overpaid', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      await payTowards(id, '1200.00');

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.paid_cny).toBe('1200.00');
      expect(body.totals.outstanding_cny).toBe('0.00');
      expect(body.totals.payment_status).toBe('PAID');
    });

    it('ignores a draft payment — a draft has moved no money', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));

      await asOwner(http().post('/api/supplier-payments'))
        .send({
          supplier_id: ctx.supplierId,
          from_account: ctx.cnyAccount,
          amount_cny: '500.00',
          purchase_id: id,
        })
        .expect(201);

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.paid_cny).toBe('0.00');
      expect(body.totals.payment_status).toBe('UNPAID');
    });

    it('does not count a payment made to the supplier but not to this order', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      // Shipped, so there is a debt for the payment to land against (§6.5).
      await shipPurchase(app, ctx.ownerToken, id);
      await payTowards(null, '700.00');

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.paid_cny).toBe('0.00');
      expect(body.totals.payment_status).toBe('UNPAID');
      // It still cleared the supplier's debt, which the card also shows.
      expect(body.supplier_balance_cny).toBe('-300.00');
    });

    it('is independent of where the goods physically are (§6)', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      await payTowards(id, '1000.00');

      // Paid in full while still sitting at the supplier's warehouse.
      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.payment_status).toBe('PAID');
      expect(body.logistics.status).toBe('SENT_TO_SUPPLIER');
    });
  });

  describe('the card itself (§2.8)', () => {
    it('carries the document, supplier, carrier and lines', async () => {
      await withYuan();
      const id = await confirmedPurchase([
        { product_id: ctx.productIds[0], qty: '10.00', price_cny: '100.00' },
        { product_id: ctx.productIds[1], qty: '4.00', price_cny: '250.50' },
      ]);

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.document.doc_number).toMatch(/^PUR-\d{4}-\d{6}$/);
      expect(body.document.status).toBe('CONFIRMED');
      expect(body.supplier.name).toBe('Yiwu Partner');
      expect(body.cargo_company.name).toBe('Silk Road Cargo');
      expect(body.items).toHaveLength(2);
      expect(body.items[0].sku).toBe(ctx.productSkus[0]);
      expect(body.items[1].line_total_cny).toBe('1002.00');
      expect(body.totals.total_cny).toBe('2002.00');
    });

    it('shows the KGS reference value as information only (§4.2)', async () => {
      await withYuan('3000.00', '13.00');
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      await shipPurchase(app, ctx.ownerToken, id);

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.totals.reference_rate_source).toBe('REFERENCE');
      expect(body.totals.reference_rate).toBe('13');
      expect(body.totals.total_kgs_reference).toBe('13000.00');
      // The debt itself is still a yuan debt.
      expect(body.supplier_balance_cny).toBe('-1000.00');
    });

    it('lists the payments made against the order', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));
      await payTowards(id, '250.00');
      await payTowards(id, '150.00');

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.payments).toHaveLength(2);
      const amounts = body.payments
        .map((p: { amount_cny: string }) => p.amount_cny)
        .sort();
      // Every amount at full scale — a Decimal serialises as "250", and a
      // screen showing "250 CNY" beside "1 002.00 CNY" reads as two
      // different kinds of figure.
      expect(amounts).toEqual(['150.00', '250.00']);
      expect(body.payments[0].kgs_value).toMatch(/^\d+\.\d{2}$/);
    });

    it('shows the status timeline (§6)', async () => {
      await withYuan();
      const id = await confirmedPurchase(oneLine('10.00', '100.00'));

      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);
      await asOwner(http().post(`/api/purchases/${id}/status`))
        .send({ status: 'SUPPLIER_ACCEPTED' })
        .expect(201);

      const { body } = await asOwner(http().get(`/api/purchase-board/${id}`)).expect(200);

      expect(body.logistics.history.map((h: { status: string }) => h.status)).toEqual([
        'DRAFT',
        'SENT_TO_SUPPLIER',
        'SUPPLIER_ACCEPTED',
      ]);
      expect(body.logistics.stage).toBe(3);
    });

    it('404s for a document that is not a purchase', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      await asOwner(http().get(`/api/purchase-board/${missing}`)).expect(404);
    });
  });

  describe('the list (§2.8)', () => {
    it('is empty before anything is ordered', async () => {
      const { body } = await asOwner(http().get('/api/purchase-board')).expect(200);
      expect(body).toEqual([]);
    });

    it('refuses an order with no lines, so no total can be undefined', async () => {
      await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          cargo_company_id: ctx.cargoCompanyId,
          items: [],
        })
        .expect(400);
    });

    it('shows a draft order as unpaid, before any payable exists', async () => {
      const { body: draft } = await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          cargo_company_id: ctx.cargoCompanyId,
          items: oneLine('2.00', '50.00'),
        })
        .expect(201);

      const { body } = await asOwner(http().get('/api/purchase-board')).expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].document_id).toBe(draft.id);
      expect(body[0].document_status).toBe('DRAFT');
      expect(body[0].total_cny).toBe('100.00');
      expect(body[0].payment_status).toBe('UNPAID');
    });

    it('carries each order with its own total and payment status', async () => {
      await withYuan();
      const first = await confirmedPurchase(oneLine('10.00', '100.00'));
      const second = await confirmedPurchase(oneLine('5.00', '200.00'));
      await payTowards(first, '1000.00');
      await payTowards(second, '300.00');

      const { body } = await asOwner(http().get('/api/purchase-board')).expect(200);

      const byId = new Map(
        body.map((row: { document_id: string }) => [row.document_id, row]),
      );
      expect(byId.get(first)).toMatchObject({
        total_cny: '1000.00',
        paid_cny: '1000.00',
        payment_status: 'PAID',
      });
      expect(byId.get(second)).toMatchObject({
        total_cny: '1000.00',
        paid_cny: '300.00',
        payment_status: 'PARTIALLY_PAID',
      });
    });

    it('filters by logistics status', async () => {
      await withYuan();
      const moving = await confirmedPurchase(oneLine('1.00', '100.00'));
      await confirmedPurchase(oneLine('1.00', '100.00'));

      await asOwner(http().post(`/api/purchases/${moving}/status`))
        .send({ status: 'SENT_TO_SUPPLIER' })
        .expect(201);

      const { body } = await asOwner(
        http().get('/api/purchase-board?logistics_status=SENT_TO_SUPPLIER'),
      ).expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].document_id).toBe(moving);
    });

    it('rejects a logistics status that is not one of the §6 stages', async () => {
      await asOwner(http().get('/api/purchase-board?logistics_status=NOWHERE')).expect(400);
    });

    it('needs a token', async () => {
      await http().get('/api/purchase-board').expect(401);
    });
  });
});
