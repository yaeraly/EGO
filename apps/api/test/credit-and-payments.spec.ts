import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { allocatePayment, AllocationError } from '../src/customer-payments/allocation';
import { createTestApp } from './app-harness';
import {
  Module4Context,
  priceProduct,
  resetModule4,
  stockLayer,
} from './module4-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Credit control and payment allocation (Module 4.9–4.10, §16, §16-А)', () => {
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
    // Cost 1 000, no markup: a unit sells for exactly 1 000, so the sums in
    // §16.3's example come out as the knowledge base writes them.
    await priceProduct(prisma, ctx.productIds[0], { baseMarkupPct: '0.00' });
    await stockLayer(app, prisma, ctx, { qty: '1000.00', unitCost: '1000.0000' });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const setLimit = (limit: string) =>
    asOwner(http().patch(`/api/customers/${ctx.customerId}`))
      .send({ individual_credit_limit: limit })
      .expect(200);

  /** A credit sale of `qty` units at 1 000 each, paying `paid` now. */
  async function creditSale(params: {
    qty: string;
    paid?: string;
    dueDate?: string;
    overrideReason?: string;
    as?: 'owner' | 'staff';
    expect?: number;
  }): Promise<{ saleId: string; status: number; body: unknown }> {
    const as = params.as ?? 'staff';
    const auth = as === 'owner' ? asOwner : asStaff;
    const till = as === 'owner' ? ctx.ownerCash : ctx.sellerCash;
    const { body: document } = await auth(http().post('/api/sales'))
      .send({
        customer_id: ctx.customerId,
        items: [{ product_id: ctx.productIds[0], qty: params.qty }],
        ...(params.paid && params.paid !== '0'
          ? { payments: [{ account_id: till, amount: params.paid }] }
          : {}),
        debt_due_date: params.dueDate ?? '2026-12-31',
      })
      .expect(201);

    const response = await auth(
      http().post(`/api/sales/${document.id}/confirm`),
    ).send({
      pin: as === 'owner' ? '12345678' : '87654321',
      ...(params.overrideReason
        ? { credit_override_reason: params.overrideReason }
        : {}),
    });

    return { saleId: document.id as string, status: response.status, body: response.body };
  }

  const standing = async () =>
    (await asStaff(http().get(`/api/sales/credit/${ctx.customerId}`)).expect(200))
      .body;

  /** Backdates a confirmed sale's due date so it counts as overdue. */
  async function makeOverdue(saleId: string): Promise<void> {
    await prisma.sales.update({
      where: { document_id: saleId },
      data: { debt_due_date: new Date('2020-01-01T00:00:00Z') },
    });
  }

  describe('§16.1 — which limit applies', () => {
    it('prefers the individual limit over the category default', async () => {
      await asOwner(http().put('/api/settings/credit.category_default_limit_kgs'))
        .send({ value: { STANDARD: 10000 } })
        .expect(200);
      await setLimit('50000.00');

      const view = await standing();
      expect(view.effective_credit_limit).toBe('50000.00');
      expect(view.limit_source).toBe('INDIVIDUAL');
    });

    it('falls back to the category default', async () => {
      await asOwner(http().put('/api/settings/credit.category_default_limit_kgs'))
        .send({ value: { STANDARD: 10000 } })
        .expect(200);

      const view = await standing();
      expect(view.effective_credit_limit).toBe('10000.00');
      expect(view.limit_source).toBe('CATEGORY');
    });

    it('refuses credit when neither is configured — unset is not unlimited', async () => {
      const view = await standing();
      expect(view.effective_credit_limit).toBeNull();
      expect(view.limit_source).toBe('UNCONFIGURED');

      const result = await creditSale({ qty: '1.00' });
      expect(result.status).toBe(422);
      expect((result.body as { code: string }).code).toBe('NO_LIMIT');
    });

    it('is OWNER-only to set (§16.1)', async () => {
      await asStaff(http().patch(`/api/customers/${ctx.customerId}`))
        .send({ individual_credit_limit: '99999.00' })
        .expect(409);
    });
  });

  describe('§16.2 and §16.3 — the limit arithmetic', () => {
    beforeEach(async () => {
      await setLimit('100000.00');
    });

    it('counts only the unpaid part as new debt (§16.2)', async () => {
      // 100 000 of goods, 80 000 paid now → 20 000 of new debt, not 100 000.
      const result = await creditSale({ qty: '100.00', paid: '80000.00' });
      expect(result.status).toBe(201);

      const view = await standing();
      expect(view.current_open_debt).toBe('20000.00');
      expect(view.available_credit).toBe('80000.00');
    });

    it('the §16.3 example: 70 000 owed, 50 000 of goods → blocked, pay 20 000', async () => {
      await creditSale({ qty: '70.00' });
      expect((await standing()).current_open_debt).toBe('70000.00');

      const blocked = await creditSale({ qty: '50.00' });
      expect(blocked.status).toBe(422);

      const body = blocked.body as {
        code: string;
        credit: Record<string, string>;
      };
      expect(body.code).toBe('LIMIT_EXCEEDED');
      expect(body.credit).toMatchObject({
        current_open_debt: '70000.00',
        new_debt: '50000.00',
        projected_debt: '120000.00',
        effective_credit_limit: '100000.00',
        must_pay_now: '20000.00',
      });
    });

    it('goes through once that 20 000 is paid now (§16.3)', async () => {
      await creditSale({ qty: '70.00' });

      const allowed = await creditSale({ qty: '50.00', paid: '20000.00' });
      expect(allowed.status).toBe(201);

      const view = await standing();
      // 70 000 + (50 000 − 20 000) = 100 000, exactly the limit.
      expect(view.current_open_debt).toBe('100000.00');
      expect(view.available_credit).toBe('0.00');
    });

    it('allows a projected debt equal to the limit', async () => {
      const result = await creditSale({ qty: '100.00' });
      expect(result.status).toBe(201);
    });

    it('never blocks a sale paid in full (§16.7)', async () => {
      await creditSale({ qty: '100.00' });
      // The customer is at the limit; a fully paid sale is untouched by it.
      const { body: document } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [{ product_id: ctx.productIds[0], qty: '50.00' }],
          payments: [{ account_id: ctx.sellerCash, amount: '50000.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${document.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);
    });
  });

  describe('§16.4 — overdue', () => {
    beforeEach(async () => {
      await setLimit('100000.00');
    });

    it('blocks new credit outright, whatever the limit says', async () => {
      const { saleId } = await creditSale({ qty: '10.00' });
      await makeOverdue(saleId);

      const view = await standing();
      expect(view.has_overdue).toBe(true);
      expect(view.overdue_amount).toBe('10000.00');
      // §16.6: available credit is effectively zero while anything is overdue.
      expect(view.available_credit).toBe('0.00');

      const blocked = await creditSale({ qty: '1.00' });
      expect(blocked.status).toBe(422);
      expect((blocked.body as { code: string }).code).toBe('OVERDUE');
    });

    it('lets a fully paid sale through anyway (§16.4)', async () => {
      const { saleId } = await creditSale({ qty: '10.00' });
      await makeOverdue(saleId);

      const { body: document } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [{ product_id: ctx.productIds[0], qty: '5.00' }],
          payments: [{ account_id: ctx.sellerCash, amount: '5000.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${document.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);
    });

    it('reports the oldest unpaid due date (§16.6)', async () => {
      const { saleId } = await creditSale({ qty: '10.00', dueDate: '2026-11-30' });
      await creditSale({ qty: '10.00', dueDate: '2026-12-31' });
      void saleId;

      const view = await standing();
      expect(view.oldest_unpaid_due_date).toBe('2026-11-30');
      expect(view.open_debts).toHaveLength(2);
    });
  });

  describe('§16.5 — the OWNER override', () => {
    beforeEach(async () => {
      await setLimit('100000.00');
    });

    it('lets the OWNER past an overdue block, with everything recorded', async () => {
      const { saleId } = await creditSale({ qty: '10.00' });
      await makeOverdue(saleId);

      const result = await creditSale({
        qty: '5.00',
        as: 'owner',
        overrideReason: 'Кардар эртең төлөйм деди, 10 жылдык байланыш',
      });
      expect(result.status).toBe(201);

      const overrides = await prisma.credit_overrides.findMany();
      expect(overrides).toHaveLength(1);
      expect(overrides[0]).toMatchObject({
        customer_id: ctx.customerId,
        sale_id: result.saleId,
        owner_id: ctx.ownerId,
      });
      expect(overrides[0].open_debt.toFixed(2)).toBe('10000.00');
      expect(overrides[0].overdue_amount.toFixed(2)).toBe('10000.00');
      expect(overrides[0].credit_limit.toFixed(2)).toBe('100000.00');
      expect(overrides[0].new_debt.toFixed(2)).toBe('5000.00');
      expect(overrides[0].projected_debt.toFixed(2)).toBe('15000.00');
      expect(overrides[0].reason).toMatch(/10 жылдык/);
    });

    it('lets the OWNER past a limit block', async () => {
      await creditSale({ qty: '70.00' });
      const result = await creditSale({
        qty: '50.00',
        as: 'owner',
        overrideReason: 'Чоң заказ, келишим бар',
      });
      expect(result.status).toBe(201);
      expect(await prisma.credit_overrides.count()).toBe(1);
    });

    it('refuses a salesperson who supplies a reason', async () => {
      await creditSale({ qty: '70.00' });
      const result = await creditSale({
        qty: '50.00',
        overrideReason: 'мен уруксат берем',
      });
      expect(result.status).toBe(403);
      expect(await prisma.credit_overrides.count()).toBe(0);
    });

    it('refuses the OWNER without a reason', async () => {
      await creditSale({ qty: '70.00' });
      const result = await creditSale({ qty: '50.00', as: 'owner' });
      expect(result.status).toBe(422);
    });

    it('cannot be used to give Walk-in credit (§11.1.2)', async () => {
      const { body: document } = await asOwner(http().post('/api/sales'))
        .send({
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          debt_due_date: '2026-12-31',
        })
        .expect(201);

      const response = await asOwner(
        http().post(`/api/sales/${document.id}/confirm`),
      ).send({ pin: '12345678', credit_override_reason: 'уруксат' });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('WALK_IN');
      expect(await prisma.credit_overrides.count()).toBe(0);
    });
  });

  describe('allocatePayment — the §16-А rules on their own', () => {
    const debts = [
      { saleId: 'sal-101', docNumber: 'SAL-101', outstanding: D('30000.00') },
      { saleId: 'sal-115', docNumber: 'SAL-115', outstanding: D('20000.00') },
    ];

    it('the §16-А.1 example: 40 000 closes 30 000 then 10 000', () => {
      const outcome = allocatePayment({ amount: D('40000.00'), debts });

      expect(outcome.lines).toEqual([
        { saleId: 'sal-101', amount: D('30000.00'), isManual: false },
        { saleId: 'sal-115', amount: D('10000.00'), isManual: false },
      ]);
      expect(outcome.overpayment.toFixed(2)).toBe('0.00');
    });

    it('follows the cashier when they name a sale (§16-А.2)', () => {
      const outcome = allocatePayment({
        amount: D('20000.00'),
        debts,
        manual: [{ saleId: 'sal-115', amount: D('20000.00') }],
      });

      expect(outcome.lines).toEqual([
        { saleId: 'sal-115', amount: D('20000.00'), isManual: true },
      ]);
    });

    it('puts what is left after a named sale onto the oldest of the rest', () => {
      const outcome = allocatePayment({
        amount: D('25000.00'),
        debts,
        manual: [{ saleId: 'sal-115', amount: D('20000.00') }],
      });

      expect(outcome.lines).toEqual([
        { saleId: 'sal-115', amount: D('20000.00'), isManual: true },
        { saleId: 'sal-101', amount: D('5000.00'), isManual: false },
      ]);
    });

    it('reports whatever is beyond every debt (§16-А.5)', () => {
      const outcome = allocatePayment({ amount: D('60000.00'), debts });
      expect(outcome.overpayment.toFixed(2)).toBe('10000.00');
    });

    it('refuses to put more on a sale than it owes', () => {
      expect(() =>
        allocatePayment({
          amount: D('40000.00'),
          debts,
          manual: [{ saleId: 'sal-115', amount: D('25000.00') }],
        }),
      ).toThrow(AllocationError);
    });

    it('refuses a sale the customer does not owe on', () => {
      expect(() =>
        allocatePayment({
          amount: D('1000.00'),
          debts,
          manual: [{ saleId: 'sal-999', amount: D('1000.00') }],
        }),
      ).toThrow(/no open debt/);
    });

    it('turns the whole payment into an advance when nothing is owed', () => {
      const outcome = allocatePayment({ amount: D('5000.00'), debts: [] });
      expect(outcome.lines).toEqual([]);
      expect(outcome.overpayment.toFixed(2)).toBe('5000.00');
    });
  });

  describe('§16-А — the payment document', () => {
    beforeEach(async () => {
      await setLimit('200000.00');
    });

    async function pay(
      amount: string,
      allocations?: { sale_id: string; amount: string }[],
    ): Promise<string> {
      const { body: document } = await asStaff(http().post('/api/customer-payments'))
        .send({
          customer_id: ctx.customerId,
          lines: [{ account_id: ctx.sellerCash, amount }],
          ...(allocations ? { allocations } : {}),
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${document.id}/confirm`)).expect(201);
      return document.id as string;
    }

    it('the §16-А.1 example, end to end', async () => {
      const older = await creditSale({ qty: '30.00', dueDate: '2026-11-30' });
      const newer = await creditSale({ qty: '20.00', dueDate: '2026-12-31' });

      const paymentId = await pay('40000.00');

      const allocations = await prisma.payment_allocations.findMany({
        where: { payment_id: paymentId },
      });
      const bySale = new Map(allocations.map((a) => [a.sale_id, a.amount]));
      expect(bySale.get(older.saleId)!.toFixed(2)).toBe('30000.00');
      expect(bySale.get(newer.saleId)!.toFixed(2)).toBe('10000.00');

      const first = await prisma.sales.findUnique({
        where: { document_id: older.saleId },
      });
      const second = await prisma.sales.findUnique({
        where: { document_id: newer.saleId },
      });
      expect(first!.outstanding_amount.toFixed(2)).toBe('0.00');
      expect(first!.debt_status).toBe('CLOSED');
      expect(second!.outstanding_amount.toFixed(2)).toBe('10000.00');
      expect(second!.debt_status).toBe('PARTIALLY_PAID');
    });

    it('follows a cashier who names a sale (§16-А.2)', async () => {
      const older = await creditSale({ qty: '30.00', dueDate: '2026-11-30' });
      const newer = await creditSale({ qty: '20.00', dueDate: '2026-12-31' });

      await pay('20000.00', [{ sale_id: newer.saleId, amount: '20000.00' }]);

      const allocation = await prisma.payment_allocations.findFirst();
      expect(allocation!.sale_id).toBe(newer.saleId);
      expect(allocation!.is_manual).toBe(true);

      expect(
        (await prisma.sales.findUnique({ where: { document_id: older.saleId } }))!
          .outstanding_amount.toFixed(2),
      ).toBe('30000.00');
    });

    it('puts the money into the account it was taken in', async () => {
      await creditSale({ qty: '30.00' });
      const paymentId = await pay('30000.00');

      const movement = await prisma.account_movements.findFirst({
        where: { document_id: paymentId },
      });
      expect(movement!.account_id).toBe(ctx.sellerCash);
      expect(movement!.amount.toFixed(2)).toBe('30000.00');
    });

    it('§16-А.5: 18 000 owed, 20 000 paid → a 2 000 ACTIVE advance', async () => {
      await creditSale({ qty: '18.00' });
      const paymentId = await pay('20000.00');

      const advance = await prisma.advances.findFirst({
        where: { customer_id: ctx.customerId },
        include: {
          documents_advances_document_idTodocuments: true,
        },
      });
      expect(advance).not.toBeNull();
      expect(advance!.amount.toFixed(2)).toBe('2000.00');
      expect(advance!.astatus).toBe('ACTIVE');
      expect(advance!.from_payment_id).toBe(paymentId);
      expect(
        advance!.documents_advances_document_idTodocuments.doc_number,
      ).toMatch(/^ADV-/);

      const payment = await prisma.customer_payments.findUnique({
        where: { document_id: paymentId },
      });
      expect(payment!.overpay_advance_doc).toBe(advance!.document_id);

      // The cashier is told, plainly, in the audit trail.
      const audit = await prisma.audit_log.findFirst({
        where: { action: 'CUSTOMER_PAYMENT_POSTED', document_id: paymentId },
      });
      expect(audit!.new_value).toMatchObject({ overpayment: '2000.00' });
    });

    it('refuses an overpayment for Walk-in (§16-А.5, §11.1.2)', async () => {
      await asStaff(http().post('/api/customer-payments'))
        .send({
          customer_id: ctx.walkInId,
          lines: [{ account_id: ctx.sellerCash, amount: '20000.00' }],
        })
        .expect(409);

      expect(await prisma.advances.count()).toBe(0);
    });

    it('the customer\'s standing follows the allocation, not a stored total', async () => {
      const first = await creditSale({ qty: '30.00', dueDate: '2026-11-30' });
      await creditSale({ qty: '20.00', dueDate: '2026-12-31' });

      expect((await standing()).current_open_debt).toBe('50000.00');
      await pay('40000.00');
      expect((await standing()).current_open_debt).toBe('10000.00');

      // The closed sale drops out of the open list entirely.
      const view = await standing();
      expect(view.open_debts.map((d: { sale_id: string }) => d.sale_id)).not.toContain(
        first.saleId,
      );
    });
  });
});
