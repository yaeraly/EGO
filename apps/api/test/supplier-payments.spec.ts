import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, doc_status } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import {
  Module2Context,
  buyCurrency,
  documentFlow,
  resetModule2,
} from './module2-harness';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('Supplier ledger and payments (Module 2.4 and 2.5)', () => {
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
  const flow = () => documentFlow(app, ctx.ownerToken);

  /** Buys CNY at a stated rate; also sets the reference rate (§10.1). */
  const buyCny = (cny: string, rate: string) =>
    buyCurrency(app, ctx, {
      kgs: D(cny).times(rate).toFixed(2),
      foreign: cny,
      toAccount: ctx.cnyAccount,
    });

  /** A confirmed order for the given CNY total, as one line. */
  async function orderFor(totalCny: string): Promise<string> {
    const { id } = await flow().createAndConfirm('/api/purchases', {
      supplier_id: ctx.supplierId,
      items: [
        { product_id: ctx.productIds[0], qty: '1.00', price_cny: totalCny },
      ],
    });
    return id;
  }

  const payment = (amountCny: string, extra: Record<string, unknown> = {}) => ({
    supplier_id: ctx.supplierId,
    from_account: ctx.cnyAccount,
    amount_cny: amountCny,
    channel: 'ALIPAY',
    ...extra,
  });

  const supplierBalance = async (): Promise<string> => {
    const res = await asOwner(
      http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
    ).expect(200);
    return res.body.balance_cny as string;
  };

  describe('what the ledger endpoint hands the screens', () => {
    it('renders every amount at full scale', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');
      await flow().createAndConfirm('/api/supplier-payments', payment('5000.00'));

      const { body } = await asOwner(
        http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
      ).expect(200);

      // A Decimal serialises as the shortest string that represents it, so
      // 5000.00 would arrive as "5000" and sit beside "-8000.00" on the same
      // screen. Scale is fixed at the boundary.
      for (const entry of body.entries) {
        expect(entry.amount_cny).toMatch(/^-?\d+\.\d{2}$/);
        if (entry.kgs_value !== null) {
          expect(entry.kgs_value).toMatch(/^-?\d+\.\d{2}$/);
        }
      }
      expect(body.balance_cny).toBe('-3000.00');
      expect(body.we_owe_cny).toBe('3000.00');
    });
  });

  describe('a confirmed order recognises the payable (§4.2)', () => {
    it('books the order total as debt, in CNY', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');

      const entries = await prisma.supplier_ledger.findMany({
        where: { supplier_id: ctx.supplierId },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entry_type).toBe('PAYABLE');
      expect(entries[0].amount_cny.toFixed(2)).toBe('-8000.00');
      expect(await supplierBalance()).toBe('-8000.00');
    });

    it('books its KGS value at the reference rate (§10.1)', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');

      const [entry] = await prisma.supplier_ledger.findMany({
        where: { supplier_id: ctx.supplierId },
      });
      // 8 000 x 13.00
      expect(entry.kgs_value?.toFixed(2)).toBe('-104000.00');
    });

    it('records the rate and its source in the audit log (§10.1)', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'PURCHASE_CONFIRMED' },
      });
      expect(audit?.new_value).toMatchObject({
        reference_rate: '13',
        reference_rate_source: 'REFERENCE',
      });
    });

    it('refuses to confirm with no reference rate at all', async () => {
      const { body } = await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', price_cny: '100.00' },
          ],
        })
        .expect(201);

      const res = await asOwner(
        http().post(`/api/documents/${body.id}/confirm`),
      ).expect(409);
      expect(res.body.message).toContain('CEX');
    });

    it('falls back to the OWNER\'s manual rate before any CEX (§10.1)', async () => {
      await asOwner(http().put('/api/settings/fx.manual_reference_rate.cny'))
        .send({ value: '12.80' })
        .expect(200);

      await orderFor('1000.00');

      const [entry] = await prisma.supplier_ledger.findMany({
        where: { supplier_id: ctx.supplierId },
      });
      expect(entry.kgs_value?.toFixed(2)).toBe('-12800.00');

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'PURCHASE_CONFIRMED' },
      });
      expect(audit?.new_value).toMatchObject({ reference_rate_source: 'MANUAL' });
    });
  });

  // Criterion 1.
  describe('a payment beyond the debt becomes an advance (§4.3)', () => {
    it('splits 10 000 against a payable of 8 000 into 8 000 + 2 000', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');

      const { id } = await flow().createAndConfirm(
        '/api/supplier-payments',
        payment('10000.00'),
      );

      const stored = await prisma.supplier_payments.findUnique({
        where: { document_id: id },
      });
      expect(stored?.debt_part_cny.toFixed(2)).toBe('8000.00');
      expect(stored?.prepay_part_cny.toFixed(2)).toBe('2000.00');
    });

    it('leaves the supplier holding 2 000 CNY of ours', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');
      await flow().createAndConfirm('/api/supplier-payments', payment('10000.00'));

      expect(await supplierBalance()).toBe('2000.00');
    });

    it('writes one PAYMENT and one PREPAYMENT entry', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');
      await flow().createAndConfirm('/api/supplier-payments', payment('10000.00'));

      const entries = await prisma.supplier_ledger.findMany({
        where: { supplier_id: ctx.supplierId },
        orderBy: { id: 'asc' },
      });
      expect(entries.map((e) => e.entry_type)).toEqual([
        'PAYABLE',
        'PAYMENT',
        'PREPAYMENT',
      ]);
      expect(entries[1].amount_cny.toFixed(2)).toBe('8000.00');
      expect(entries[2].amount_cny.toFixed(2)).toBe('2000.00');
    });

    it('never drives the payable negative, however much is paid', async () => {
      await buyCny('50000.00', '13.00');
      await orderFor('8000.00');
      await flow().createAndConfirm('/api/supplier-payments', payment('30000.00'));

      const debt = await prisma.supplier_ledger.aggregate({
        where: {
          supplier_id: ctx.supplierId,
          entry_type: { in: ['PAYABLE', 'PAYMENT'] },
        },
        _sum: { amount_cny: true },
      });
      expect(debt._sum.amount_cny?.toFixed(2)).toBe('0.00');
    });
  });

  // Criterion 2.
  describe('FX gain and loss on settling debt (§10.2)', () => {
    /**
     * Debt recognised at 13.00; the yuan that settle it are half from a 13.00
     * layer and half from a 14.00 one, so they average 13.50.
     */
    async function debtAt13PaidAt13Point5(): Promise<string> {
      await buyCny('5000.00', '13.00');
      const purchaseId = await orderFor('10000.00');
      await buyCny('5000.00', '14.00');

      const { id } = await flow().createAndConfirm(
        '/api/supplier-payments',
        payment('10000.00', { purchase_id: purchaseId }),
      );
      return id;
    }

    it('books the loss when the yuan cost more than the debt was booked at', async () => {
      const id = await debtAt13PaidAt13Point5();

      const stored = await prisma.supplier_payments.findUnique({
        where: { document_id: id },
      });
      // recognised 10 000 x 13.00 = 130 000; paid 5 000x13 + 5 000x14 = 135 000
      expect(stored?.kgs_value.toFixed(2)).toBe('135000.00');
      expect(stored?.fx_gain_loss_kgs.toFixed(2)).toBe('-5000.00');
    });

    it('books a gain when the yuan cost less', async () => {
      await buyCny('5000.00', '14.00');
      const purchaseId = await orderFor('10000.00'); // recognised at 14.00
      await buyCny('5000.00', '13.00');

      const { id } = await flow().createAndConfirm(
        '/api/supplier-payments',
        payment('10000.00', { purchase_id: purchaseId }),
      );

      const stored = await prisma.supplier_payments.findUnique({
        where: { document_id: id },
      });
      // recognised 140 000; paid 5 000x14 + 5 000x13 = 135 000
      expect(stored?.fx_gain_loss_kgs.toFixed(2)).toBe('5000.00');
    });

    it('books nothing when the rate did not move', async () => {
      await buyCny('20000.00', '13.00');
      const purchaseId = await orderFor('10000.00');

      const { id } = await flow().createAndConfirm(
        '/api/supplier-payments',
        payment('10000.00', { purchase_id: purchaseId }),
      );

      const stored = await prisma.supplier_payments.findUnique({
        where: { document_id: id },
      });
      expect(stored?.fx_gain_loss_kgs.toFixed(2)).toBe('0.00');
    });

    /**
     * The isolation the criterion asks for: an exchange result is a financial
     * item. It must not reach the goods' cost, and it must not reach anyone's
     * bonus (§10.2, §23.5).
     */
    it('leaves the goods\' cost and the bonus base untouched', async () => {
      await debtAt13PaidAt13Point5();

      // Nothing in Module 2 writes stock or margin, and the FX result lives
      // only on the payment document.
      expect(await prisma.fifo_layers.count()).toBe(0);
      expect(await prisma.lot_items.count()).toBe(0);
      expect(await prisma.bonuses.count()).toBe(0);
      expect(await prisma.sale_items.count()).toBe(0);

      const fx = await prisma.supplier_payments.aggregate({
        _sum: { fx_gain_loss_kgs: true },
      });
      expect(fx._sum.fx_gain_loss_kgs?.toFixed(2)).toBe('-5000.00');
    });

    it('produces no FX on the advance part — it is carried at cost', async () => {
      await buyCny('20000.00', '13.00');
      // No order at all, so the whole payment is an advance.
      const { id } = await flow().createAndConfirm(
        '/api/supplier-payments',
        payment('5000.00'),
      );

      const stored = await prisma.supplier_payments.findUnique({
        where: { document_id: id },
      });
      expect(stored?.debt_part_cny.toFixed(2)).toBe('0.00');
      expect(stored?.prepay_part_cny.toFixed(2)).toBe('5000.00');
      expect(stored?.fx_gain_loss_kgs.toFixed(2)).toBe('0.00');
      expect(stored?.kgs_value.toFixed(2)).toBe('65000.00');
    });
  });

  // Criterion 3.
  describe('a till that cannot cover the payment blocks it (§10-А.4)', () => {
    it('refuses 6 000 CNY against a till holding 5 000', async () => {
      await buyCny('5000.00', '13.00');
      await orderFor('6000.00');

      const { body } = await asOwner(http().post('/api/supplier-payments'))
        .send(payment('6000.00'))
        .expect(201);

      const res = await asOwner(
        http().post(`/api/documents/${body.id}/confirm`),
      ).expect(409);
      expect(res.body.message).toContain('CEX');
      expect(res.body.message).toContain('5000.00');
    });

    it('leaves nothing behind — no ledger, no movement, no layer touched', async () => {
      await buyCny('5000.00', '13.00');
      await orderFor('6000.00');
      const layersBefore = await prisma.currency_layers.findMany();

      const { body } = await asOwner(http().post('/api/supplier-payments'))
        .send(payment('6000.00'))
        .expect(201);
      await asOwner(http().post(`/api/documents/${body.id}/confirm`)).expect(409);

      expect(
        await prisma.supplier_ledger.count({
          where: { document_id: body.id },
        }),
      ).toBe(0);
      expect(
        await prisma.account_movements.count({ where: { document_id: body.id } }),
      ).toBe(0);
      expect(
        await prisma.currency_layer_consumptions.count({
          where: { document_id: body.id },
        }),
      ).toBe(0);
      expect(await prisma.currency_layers.findMany()).toEqual(layersBefore);

      const stored = await prisma.documents.findUnique({ where: { id: body.id } });
      expect(stored?.status).toBe(doc_status.DRAFT);
      expect(await supplierBalance()).toBe('-6000.00');
    });
  });

  // Criterion 5.
  describe('the ledger stays right across a run of payments', () => {
    it('handles three payments that together overpay', async () => {
      await buyCny('60000.00', '13.00');
      await orderFor('10000.00');

      for (const amount of ['3000.00', '4000.00', '8000.00']) {
        await flow().createAndConfirm('/api/supplier-payments', payment(amount));
      }

      // 10 000 owed, 15 000 paid: debt closed, 5 000 left as an advance.
      const debt = await prisma.supplier_ledger.aggregate({
        where: {
          supplier_id: ctx.supplierId,
          entry_type: { in: ['PAYABLE', 'PAYMENT'] },
        },
        _sum: { amount_cny: true },
      });
      expect(debt._sum.amount_cny?.toFixed(2)).toBe('0.00');
      expect(await supplierBalance()).toBe('5000.00');
    });

    it.each([
      [['1000.00', '1000.00', '1000.00'], '7000.00', '-4000.00'],
      [['5000.00', '5000.00', '5000.00'], '10000.00', '5000.00'],
      [['9999.99', '0.01', '100.00'], '10000.00', '100.00'],
      [['0.01', '0.01', '0.01'], '0.03', '0.00'],
    ])(
      'payments %p against a payable of %s leave a balance of %s',
      async (amounts, payable, expected) => {
        await buyCny('60000.00', '13.00');
        await orderFor(payable);

        for (const amount of amounts) {
          await flow().createAndConfirm('/api/supplier-payments', payment(amount));
        }

        expect(await supplierBalance()).toBe(expected);

        // The invariant §4.3 states: the payable never goes negative.
        const debt = await prisma.supplier_ledger.aggregate({
          where: {
            supplier_id: ctx.supplierId,
            entry_type: { in: ['PAYABLE', 'PAYMENT'] },
          },
          _sum: { amount_cny: true },
        });
        expect(debt._sum.amount_cny!.lessThanOrEqualTo(0)).toBe(true);
      },
    );

    it('keeps the ledger and the till telling the same story', async () => {
      await buyCny('60000.00', '13.00');
      await orderFor('10000.00');
      for (const amount of ['3000.00', '4000.00', '8000.00']) {
        await flow().createAndConfirm('/api/supplier-payments', payment(amount));
      }

      const paid = await prisma.supplier_payments.aggregate({
        _sum: { amount_cny: true },
      });
      const { body } = await asOwner(
        http().get(`/api/accounts/${ctx.cnyAccount}/balance`),
      ).expect(200);

      // 60 000 bought, 15 000 paid out.
      expect(paid._sum.amount_cny?.toFixed(2)).toBe('15000.00');
      expect(body.balance).toBe('45000.00');
    });
  });

  // Criterion 6.
  describe('a repeated request is recorded once', () => {
    it('writes one payment for one idempotency key', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');

      const send = () =>
        asOwner(http().post('/api/supplier-payments'))
          .set('Idempotency-Key', 'spy-retry-1')
          .send(payment('5000.00'));

      const first = await send().expect(201);
      const second = await send().expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(await prisma.supplier_payments.count()).toBe(1);
      expect(
        await prisma.documents.count({ where: { doc_type: 'SPY' } }),
      ).toBe(1);
    });

    it('moves the money once when a confirm is retried', async () => {
      await buyCny('20000.00', '13.00');
      await orderFor('8000.00');
      const { body } = await asOwner(http().post('/api/supplier-payments'))
        .send(payment('5000.00'))
        .expect(201);

      const confirm = () =>
        asOwner(http().post(`/api/documents/${body.id}/confirm`))
          .set('Idempotency-Key', 'spy-confirm-1');

      await confirm().expect(201);
      await confirm().expect(201);

      expect(
        await prisma.account_movements.count({ where: { document_id: body.id } }),
      ).toBe(1);
      expect(
        await prisma.supplier_ledger.count({ where: { document_id: body.id } }),
      ).toBe(1);
      expect(await supplierBalance()).toBe('-3000.00');
    });
  });

  describe('validation', () => {
    it('refuses a non-CNY till', async () => {
      const res = await asOwner(http().post('/api/supplier-payments'))
        .send({ ...payment('100.00'), from_account: ctx.kgsAccount })
        .expect(400);
      expect(res.body.message).toContain('CNY');
    });

    it('refuses a purchase belonging to another supplier', async () => {
      await buyCny('20000.00', '13.00');
      const purchaseId = await orderFor('1000.00');
      const { body: other } = await asOwner(http().post('/api/suppliers'))
        .send({ name: 'Another Partner' })
        .expect(201);

      await asOwner(http().post('/api/supplier-payments'))
        .send({
          ...payment('100.00'),
          supplier_id: other.id,
          purchase_id: purchaseId,
        })
        .expect(400);
    });

    it('refuses a salesperson (§2)', async () => {
      await request(app.getHttpServer())
        .post('/api/supplier-payments')
        .set('Authorization', `Bearer ${ctx.staffToken}`)
        .send(payment('100.00'))
        .expect(403);
    });

    it.each([['0.00'], ['-100.00']])('refuses an amount of %s', async (amount) => {
      await asOwner(http().post('/api/supplier-payments'))
        .send(payment(amount))
        .expect(400);
    });

    it('refuses a JSON number as the amount', async () => {
      await asOwner(http().post('/api/supplier-payments'))
        .send({ ...payment('1.00'), amount_cny: 5000 })
        .expect(400);
    });
  });
});
