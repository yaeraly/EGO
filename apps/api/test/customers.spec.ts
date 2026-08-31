import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { categoryFor, windowStart } from '../src/customers/category-calculation';
import { CategoryJobService } from '../src/customers/category-job.service';
import { DebtAlertsService } from '../src/credit/debt-alerts.service';
import { createTestApp } from './app-harness';
import {
  Module4Context,
  priceProduct,
  resetModule4,
  stockLayer,
} from './module4-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Customers, categories and debt alerts (Module 4.1–4.2, §11, §12, §16)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryJob: CategoryJobService;
  let debtAlerts: DebtAlertsService;
  let ctx: Module4Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    categoryJob = app.get(CategoryJobService);
    debtAlerts = app.get(DebtAlertsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule4(app, prisma);
    await priceProduct(prisma, ctx.productIds[0], { baseMarkupPct: '0.00' });
    await stockLayer(app, prisma, ctx, { qty: '1000.00', unitCost: '1000.0000' });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  /** A confirmed, fully paid sale of `qty` units at 1 000 each. */
  async function sell(qty: string, businessDate?: string): Promise<string> {
    const { body: document } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.customerId,
        items: [{ product_id: ctx.productIds[0], qty }],
        payments: [
          {
            account_id: ctx.sellerCash,
            amount: D(qty).times(1000).toFixed(2),
          },
        ],
        ...(businessDate ? { business_date: businessDate } : {}),
      })
      .expect(201);

    await asStaff(http().post(`/api/sales/${document.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);
    return document.id as string;
  }

  describe('§11 — the customer list', () => {
    it('finds by name or phone (§14)', async () => {
      const byName = await asStaff(http().get('/api/customers?q=Азам')).expect(200);
      expect(byName.body.map((c: { id: string }) => c.id)).toContain(ctx.customerId);

      const byPhone = await asStaff(http().get('/api/customers?q=0555111')).expect(200);
      expect(byPhone.body.map((c: { id: string }) => c.id)).toContain(ctx.customerId);

      const nothing = await asStaff(http().get('/api/customers?q=zzzz')).expect(200);
      expect(nothing.body).toEqual([]);
    });

    it('is created by a salesperson — that is the job at the counter', async () => {
      const { body } = await asStaff(http().post('/api/customers'))
        .send({ name: 'Нурбек', phone: '0777222333', ctype: 'WHOLESALE' })
        .expect(201);
      expect(body.ctype).toBe('WHOLESALE');
      expect(body.category).toBe('STANDARD');
    });

    it('keeps the individual credit limit to the OWNER (§16.1)', async () => {
      await asStaff(http().post('/api/customers'))
        .send({ name: 'Лимитчи', individual_credit_limit: '100000.00' })
        .expect(409);

      await asOwner(http().post('/api/customers'))
        .send({ name: 'Лимитчи', individual_credit_limit: '100000.00' })
        .expect(201);
    });
  });

  describe('§11.1 — Walk-in is one customer, and a restricted one', () => {
    it('is reachable by its own endpoint', async () => {
      const { body } = await asStaff(http().get('/api/customers/walk-in')).expect(200);
      expect(body.id).toBe(ctx.walkInId);
      expect(body.is_walk_in).toBe(true);
    });

    it('cannot be duplicated — the database enforces it', async () => {
      await expect(
        prisma.customers.create({
          data: { is_walk_in: true, name: 'Экинчи walk-in' },
        }),
      ).rejects.toThrow();
    });

    it('takes no credit limit (§11.1.2)', async () => {
      const { body } = await asOwner(http().patch(`/api/customers/${ctx.walkInId}`))
        .send({ individual_credit_limit: '50000.00' })
        .expect(409);
      expect(body.message).toMatch(/Walk-in/);
      expect(body.message).toMatch(/§11\.1\.2/);
    });

    it('takes no category (§11.1.2)', async () => {
      await asOwner(http().patch(`/api/customers/${ctx.walkInId}/category`))
        .send({ category: 'VIP', reason: 'көп сатып алат' })
        .expect(409);
    });

    it('cannot be deactivated — retail sales need somewhere to go', async () => {
      await asOwner(http().patch(`/api/customers/${ctx.walkInId}`))
        .send({ is_active: false })
        .expect(409);
    });

    it('is left out of the category recalculation (§11.1.3)', async () => {
      const result = await categoryJob.run();
      expect(
        result.changed.map((c: { customer_id: string }) => c.customer_id),
      ).not.toContain(ctx.walkInId);
    });
  });

  describe('categoryFor — the bands on their own (§12)', () => {
    const thresholds = [
      { category: 'STANDARD' as const, from: D('0') },
      { category: 'SILVER' as const, from: D('50000') },
    ];

    it('puts 0 and 49 999 in Standard', () => {
      expect(categoryFor(D('0'), thresholds)).toBe('STANDARD');
      expect(categoryFor(D('49999.99'), thresholds)).toBe('STANDARD');
    });

    it('puts 50 000 in Silver — the boundary is inclusive', () => {
      expect(categoryFor(D('50000'), thresholds)).toBe('SILVER');
      expect(categoryFor(D('99999'), thresholds)).toBe('SILVER');
    });

    it('stays in the highest configured band when Gold is unset', () => {
      // §12 leaves Gold and VIP "кийин такталат"; a huge turnover cannot be
      // promoted into a band nobody has defined.
      expect(categoryFor(D('5000000'), thresholds)).toBe('SILVER');
    });

    it('measures the window from today, to the day', () => {
      const start = windowStart(12, new Date('2026-08-31T15:00:00Z'));
      expect(start.toISOString().slice(0, 10)).toBe('2025-08-31');
    });
  });

  describe('§12.1 — the monthly recalculation', () => {
    beforeEach(async () => {
      await asOwner(http().put('/api/settings/customer.category.silver.threshold_kgs'))
        .send({ value: 50000 })
        .expect(200);
    });

    it('promotes a customer whose 12-month turnover crosses the threshold', async () => {
      await sell('60.00');

      const result = await categoryJob.run();

      expect(result.changed).toHaveLength(1);
      expect(result.changed[0]).toMatchObject({
        customer_id: ctx.customerId,
        from: 'STANDARD',
        to: 'SILVER',
        turnover_kgs: '60000.00',
      });

      const customer = await prisma.customers.findUnique({
        where: { id: ctx.customerId },
      });
      expect(customer!.category).toBe('SILVER');
      expect(customer!.category_manual_override).toBe(false);
    });

    it('records the change in the audit log', async () => {
      await sell('60.00');
      await categoryJob.run();

      const audit = await prisma.audit_log.findFirst({
        where: {
          action: 'CUSTOMER_CATEGORY_RECALCULATED',
          entity_id: ctx.customerId,
        },
      });
      expect(audit!.new_value).toMatchObject({
        category: 'SILVER',
        turnover_kgs: '60000.00',
        window_months: 12,
      });
    });

    it('demotes when the turnover falls away (§12.1)', async () => {
      await sell('60.00');
      await categoryJob.run();
      expect(
        (await prisma.customers.findUnique({ where: { id: ctx.customerId } }))!
          .category,
      ).toBe('SILVER');

      // Everything drops out of the window.
      await prisma.documents.updateMany({
        where: { doc_type: 'SAL' },
        data: { business_date: new Date('2020-01-01T00:00:00Z') },
      });

      const result = await categoryJob.run();
      expect(result.changed[0]).toMatchObject({ from: 'SILVER', to: 'STANDARD' });
    });

    it('ignores turnover older than the window', async () => {
      await sell('60.00', '2024-01-15');

      const result = await categoryJob.run();
      expect(result.changed).toHaveLength(0);
      expect(
        (await prisma.customers.findUnique({ where: { id: ctx.customerId } }))!
          .category,
      ).toBe('STANDARD');
    });

    it('leaves a manually categorised customer alone (§12.1)', async () => {
      await asOwner(http().patch(`/api/customers/${ctx.customerId}/category`))
        .send({ category: 'GOLD', reason: 'Эски досубуз, көлөмү туруктуу' })
        .expect(200);

      await sell('60.00');
      const result = await categoryJob.run();

      expect(result.changed).toHaveLength(0);
      expect(result.skipped_manual).toBe(1);
      expect(
        (await prisma.customers.findUnique({ where: { id: ctx.customerId } }))!
          .category,
      ).toBe('GOLD');
    });

    it('hands the customer back once the override is cleared', async () => {
      await asOwner(http().patch(`/api/customers/${ctx.customerId}/category`))
        .send({ category: 'GOLD', reason: 'убактылуу' })
        .expect(200);
      await sell('60.00');
      await categoryJob.run();

      await asOwner(http().delete(`/api/customers/${ctx.customerId}/category`)).expect(200);

      const result = await categoryJob.run();
      expect(result.changed[0]).toMatchObject({ from: 'GOLD', to: 'SILVER' });
    });

    it('a manual category is the OWNER\'s and is audited with a reason', async () => {
      await asStaff(http().patch(`/api/customers/${ctx.customerId}/category`))
        .send({ category: 'VIP', reason: 'мен чечтим' })
        .expect(403);

      await asOwner(http().patch(`/api/customers/${ctx.customerId}/category`))
        .send({ category: 'VIP', reason: 'Жылына 2 млн сатып алат' })
        .expect(200);

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'CUSTOMER_CATEGORY_SET_MANUALLY' },
      });
      expect(audit!.reason).toMatch(/2 млн/);
    });
  });

  describe('§16 and §16.4 — the nightly debt sweep', () => {
    beforeEach(async () => {
      await asOwner(http().patch(`/api/customers/${ctx.customerId}`))
        .send({ individual_credit_limit: '500000.00' })
        .expect(200);
    });

    async function creditSale(qty: string, dueDate: string): Promise<string> {
      const { body: document } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [{ product_id: ctx.productIds[0], qty }],
          debt_due_date: dueDate,
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${document.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);
      return document.id as string;
    }

    const ownerAlerts = async () =>
      (await asOwner(http().get('/api/notifications')).expect(200)).body.items as {
        kind: string;
        title: string;
        body: string;
      }[];

    it('raises nothing when no debt is late or near', async () => {
      const result = await debtAlerts.run(new Date('2026-08-31T06:00:00Z'));
      expect(result.overdue.customers).toBe(0);
      expect(result.due_soon.debts).toBe(0);
      expect(await ownerAlerts()).toEqual([]);
    });

    it('reports an overdue debt to the OWNER (§16.4, §39)', async () => {
      const saleId = await creditSale('10.00', '2026-12-31');
      await prisma.sales.update({
        where: { document_id: saleId },
        data: { debt_due_date: new Date('2026-08-01T00:00:00Z') },
      });

      const result = await debtAlerts.run(new Date('2026-08-31T06:00:00Z'));

      expect(result.overdue).toMatchObject({
        customers: 1,
        total: '10000.00',
      });
      const [alert] = await ownerAlerts();
      expect(alert.kind).toBe('CUSTOMER_DEBT_OVERDUE');
      expect(alert.body).toContain('Азамат');
    });

    it('warns three days ahead, the salesperson as well as the OWNER (§16)', async () => {
      await creditSale('10.00', '2026-09-02');

      const result = await debtAlerts.run(new Date('2026-08-31T06:00:00Z'));
      expect(result.due_soon).toMatchObject({ warning_days: 3, debts: 1 });

      const [ownerAlert] = await ownerAlerts();
      expect(ownerAlert.kind).toBe('CUSTOMER_DEBT_DUE_SOON');

      const staffAlerts = await asStaff(http().get('/api/notifications')).expect(200);
      expect(staffAlerts.body.items).toHaveLength(1);
      expect(staffAlerts.body.items[0].body).toMatch(/2026-09-02/);
    });

    it('does not warn about a debt further out than the window', async () => {
      await creditSale('10.00', '2026-10-15');
      const result = await debtAlerts.run(new Date('2026-08-31T06:00:00Z'));
      expect(result.due_soon.debts).toBe(0);
    });

    it('does not repeat the same alert on a second run the same day', async () => {
      await creditSale('10.00', '2026-09-02');
      // Both within the same Bishkek day: 06:00 and 12:00 UTC are 12:00 and
      // 18:00 there, so the dedupe key is the same.
      await debtAlerts.run(new Date('2026-08-31T06:00:00Z'));
      await debtAlerts.run(new Date('2026-08-31T12:00:00Z'));

      const staffAlerts = await asStaff(http().get('/api/notifications')).expect(200);
      expect(staffAlerts.body.items).toHaveLength(1);
    });

    it('stops reporting a debt once it is paid', async () => {
      const saleId = await creditSale('10.00', '2026-12-31');
      await prisma.sales.update({
        where: { document_id: saleId },
        data: { debt_due_date: new Date('2026-08-01T00:00:00Z') },
      });

      const { body: payment } = await asStaff(http().post('/api/customer-payments'))
        .send({
          customer_id: ctx.customerId,
          lines: [{ account_id: ctx.sellerCash, amount: '10000.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${payment.id}/confirm`)).expect(201);

      const result = await debtAlerts.run(new Date('2026-08-31T06:00:00Z'));
      expect(result.overdue.customers).toBe(0);
    });
  });
});
