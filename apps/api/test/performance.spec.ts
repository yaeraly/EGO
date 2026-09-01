import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import {
  achievement,
  averageSale,
  purchaseFrequencyDays,
} from '../src/reports/performance-math';

const D = (value: string) => new Prisma.Decimal(value);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('Plans, sellers and customers (Module 17, §24, §30, §31)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module4Context;
  let today: string;

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
    today = new Date().toISOString().slice(0, 10);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const sellers = () =>
    asOwner(http().get('/api/reports/sellers')).query({ from: '2026-01-01', to: today });
  const customers = () =>
    asOwner(http().get('/api/reports/customers')).query({
      from: '2026-01-01',
      to: today,
    });

  const thisMonth = () => ({
    period_year: Number(today.slice(0, 4)),
    period_month: Number(today.slice(5, 7)),
  });

  /** A sale by the staff salesperson, paid or on credit. */
  async function sell(params: {
    customerId?: string;
    price: string;
    cost?: string;
    onCredit?: boolean;
  }): Promise<string> {
    await stockLayer(app, prisma, ctx, {
      qty: '1.00',
      unitCost: params.cost ?? '4000.0000',
    });
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: params.customerId ?? ctx.walkInId,
        items: [
          { product_id: ctx.productIds[0], qty: '1.00', final_price: params.price },
        ],
        ...(params.onCredit
          ? { debt_due_date: '2026-12-31' }
          : {
              payments: [{ account_id: ctx.sellerCash, amount: params.price }],
            }),
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);
    return draft.id as string;
  }

  async function allowCredit(customerId: string) {
    await prisma.customers.update({
      where: { id: customerId },
      data: { individual_credit_limit: '100000.00' },
    });
  }

  describe('The arithmetic, stated on its own', () => {
    it('reports achievement against a target, and nothing without one (§24)', () => {
      expect(achievement(D('75000.00'), D('100000.00'))).toBe('75.00');
      expect(achievement(D('120000.00'), D('100000.00'))).toBe('120.00');
      // An unset plan is not a plan of zero.
      expect(achievement(D('75000.00'), null)).toBeNull();
      expect(achievement(D('75000.00'), D('0.00'))).toBeNull();
    });

    it('averages a sale only when there was one (§31)', () => {
      expect(averageSale(D('90000.00'), 4)).toBe('22500.00');
      expect(averageSale(D('0.00'), 0)).toBeNull();
    });

    it('measures how often a customer buys, in days between purchases (§30)', () => {
      // Four purchases spanning 90 days: three gaps of 30.
      expect(
        purchaseFrequencyDays({
          first: day('2026-01-01'),
          last: day('2026-04-01'),
          purchases: 4,
        }),
      ).toBe('30.0');
      // One purchase has no gap to measure, and neither has a single day.
      expect(
        purchaseFrequencyDays({
          first: day('2026-01-01'),
          last: day('2026-01-01'),
          purchases: 1,
        }),
      ).toBeNull();
      expect(
        purchaseFrequencyDays({
          first: day('2026-01-01'),
          last: day('2026-01-01'),
          purchases: 3,
        }),
      ).toBeNull();
    });
  });

  describe('The plan itself (§24)', () => {
    it('is the OWNER’s to set, for a person or for the business', async () => {
      await asStaff(http().put('/api/plans'))
        .send({ ...thisMonth(), revenue_target: '100000.00' })
        .expect(403);

      const { body: business } = await asOwner(http().put('/api/plans'))
        .send({
          ...thisMonth(),
          revenue_target: '500000.00',
          margin_target: '100000.00',
          new_customers_target: 5,
        })
        .expect(200);
      expect(business.user_id).toBeNull();
      expect(business.full_name).toBeNull();

      const { body: personal } = await asOwner(http().put('/api/plans'))
        .send({
          ...thisMonth(),
          user_id: ctx.staffId,
          revenue_target: '200000.00',
        })
        .expect(200);
      expect(personal.user_id).toBe(ctx.staffId);
      expect(personal.revenue_target).toBe('200000.00');
      expect(personal.margin_target).toBeNull();

      const { body: list } = await asOwner(http().get('/api/plans'))
        .query(thisMonth())
        .expect(200);
      expect(list).toHaveLength(2);
    });

    it('replaces the month’s plan rather than making a second one', async () => {
      await asOwner(http().put('/api/plans'))
        .send({ ...thisMonth(), revenue_target: '100000.00' })
        .expect(200);
      const { body } = await asOwner(http().put('/api/plans'))
        .send({ ...thisMonth(), revenue_target: '150000.00' })
        .expect(200);
      expect(body.revenue_target).toBe('150000.00');

      const { body: list } = await asOwner(http().get('/api/plans')).expect(200);
      expect(list).toHaveLength(1);

      // Both the setting and the change are on the record (§27).
      const entries = await prisma.audit_log.findMany({
        where: { entity: 'sales_plans' },
        orderBy: { id: 'asc' },
      });
      expect(entries.map((entry) => entry.action)).toEqual([
        'PLAN_SET',
        'PLAN_UPDATED',
      ]);
    });

    it('refuses a plan with no target in it at all', async () => {
      await asOwner(http().put('/api/plans'))
        .send({ ...thisMonth(), comment: 'Жакшы иштегиле' })
        .expect(400);
    });

    it('can be taken away again', async () => {
      const { body } = await asOwner(http().put('/api/plans'))
        .send({ ...thisMonth(), revenue_target: '100000.00' })
        .expect(200);
      await asOwner(http().delete(`/api/plans/${body.id}`)).expect(200);
      expect((await asOwner(http().get('/api/plans')).expect(200)).body).toEqual([]);
    });
  });

  describe('By salesperson (§31, §24)', () => {
    it('shows what they sold, their margin and their average sale', async () => {
      await sell({ price: '9000.00', cost: '4000.0000' });
      await sell({ price: '11000.00', cost: '4000.0000' });

      const { body } = await sellers().expect(200);
      const seller = body.sellers.find(
        (row: { user_id: string }) => row.user_id === ctx.staffId,
      );
      expect(seller.sales).toBe(2);
      expect(seller.revenue).toBe('20000.00');
      expect(seller.margin).toBe('12000.00');
      expect(seller.average_sale).toBe('10000.00');
      expect(seller.margin_pct).toBe('60.00');
    });

    it('counts a credit sale as one, and says how much is owed on it (§16)', async () => {
      await allowCredit(ctx.customerId);
      await sell({ customerId: ctx.customerId, price: '9000.00', onCredit: true });
      await sell({ price: '5000.00' });

      const { body } = await sellers().expect(200);
      const seller = body.sellers.find(
        (row: { user_id: string }) => row.user_id === ctx.staffId,
      );
      expect(seller.sales).toBe(2);
      expect(seller.credit_sales).toBe(1);
      expect(seller.credit_revenue).toBe('9000.00');
    });

    it('credits a new customer to whoever first sold to them (§24)', async () => {
      await allowCredit(ctx.customerId);
      await sell({ customerId: ctx.customerId, price: '9000.00' });
      // A second sale to the same customer does not make them new again.
      await sell({ customerId: ctx.customerId, price: '4000.00', cost: '1000.0000' });
      // Walk-in stands for everyone unregistered, and is never a new customer.
      await sell({ price: '3000.00', cost: '1000.0000' });

      const { body } = await sellers().expect(200);
      const seller = body.sellers.find(
        (row: { user_id: string }) => row.user_id === ctx.staffId,
      );
      expect(seller.new_customers).toBe(1);
      expect(body.totals.new_customers).toBe(1);
    });

    it('measures the plan against the result, and says nothing without one (§24)', async () => {
      await sell({ price: '9000.00', cost: '4000.0000' });

      const without = await sellers().expect(200);
      const before = without.body.sellers.find(
        (row: { user_id: string }) => row.user_id === ctx.staffId,
      );
      expect(before.plan).toBeNull();
      expect(before.achievement.revenue_pct).toBeNull();

      await asOwner(http().put('/api/plans'))
        .send({
          ...thisMonth(),
          user_id: ctx.staffId,
          revenue_target: '18000.00',
          new_customers_target: 4,
        })
        .expect(200);
      await asOwner(http().put('/api/plans'))
        .send({ ...thisMonth(), revenue_target: '36000.00' })
        .expect(200);

      const { body } = await sellers().expect(200);
      const seller = body.sellers.find(
        (row: { user_id: string }) => row.user_id === ctx.staffId,
      );
      expect(seller.plan.revenue_target).toBe('18000.00');
      expect(seller.achievement.revenue_pct).toBe('50.00');
      // No margin target was set, so there is no margin percentage.
      expect(seller.achievement.margin_pct).toBeNull();
      expect(seller.achievement.new_customers_pct).toBe('0.00');

      expect(body.business_plan.revenue_target).toBe('36000.00');
      expect(body.business_achievement.revenue_pct).toBe('25.00');
    });

    it('shows their own tills and their bonus standing (§19, §23)', async () => {
      await sell({ price: '9000.00', cost: '4000.0000' });

      const { body } = await sellers().expect(200);
      const seller = body.sellers.find(
        (row: { user_id: string }) => row.user_id === ctx.staffId,
      );
      expect(seller.accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Seller Cash', balance: '9000.00' }),
        ]),
      );
      // The fixture sets no bonus rate, so the bonus is recorded at zero.
      expect(seller.bonus).toEqual({ PAYABLE: '0.00' });
    });

    it('is the OWNER’s picture of the shop floor (§2)', async () => {
      await asStaff(http().get('/api/reports/sellers')).expect(403);
      await asStaff(http().get('/api/reports/customers')).expect(403);
    });
  });

  describe('By customer (§30)', () => {
    it('shows what they bought, what it earned and what they still owe', async () => {
      await allowCredit(ctx.customerId);
      await sell({ customerId: ctx.customerId, price: '9000.00', cost: '4000.0000' });
      await sell({
        customerId: ctx.customerId,
        price: '6000.00',
        cost: '4000.0000',
        onCredit: true,
      });

      const { body } = await customers().expect(200);
      const customer = body.customers.find(
        (row: { customer_id: string }) => row.customer_id === ctx.customerId,
      );
      expect(customer.purchases).toBe(2);
      expect(customer.revenue).toBe('15000.00');
      expect(customer.margin).toBe('7000.00');
      expect(customer.debt).toBe('6000.00');
      expect(customer.last_purchase).toBe(today);
      expect(customer.ctype).toBe('RETAIL');
      // Both purchases fall on one day, so there is no frequency to state.
      expect(customer.frequency_days).toBeNull();
    });

    it('leaves the Walk-in row out — it is not a customer (§11.1)', async () => {
      await sell({ price: '9000.00' });

      const { body } = await customers().expect(200);
      expect(
        body.customers.find(
          (row: { customer_id: string }) => row.customer_id === ctx.walkInId,
        ),
      ).toBeUndefined();
    });

    it('ranks who brought the most money and who brought the most margin', async () => {
      const second = await prisma.customers.create({
        data: { name: 'Бакыт', phone: '0555999888', ctype: 'RETAIL' },
        select: { id: true },
      });

      // Азамат buys more; Бакыт buys at a better margin.
      await sell({ customerId: ctx.customerId, price: '20000.00', cost: '18000.0000' });
      await sell({ customerId: second.id, price: '12000.00', cost: '2000.0000' });

      const { body } = await customers().expect(200);
      expect(body.top_by_revenue[0].customer_id).toBe(ctx.customerId);
      expect(body.top_by_margin[0].customer_id).toBe(second.id);
    });

    it('counts how a customer’s reservations ended (§17, §30)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '4000.0000' });
      const { body: reservation } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${reservation.id}/confirm`)).expect(
        201,
      );
      await sell({ customerId: ctx.customerId, price: '9000.00' });

      const { body } = await customers().expect(200);
      const customer = body.customers.find(
        (row: { customer_id: string }) => row.customer_id === ctx.customerId,
      );
      expect(customer.reservations).toEqual({ ACTIVE: 1 });
    });

    it('lists customers who used to buy and have stopped (§30)', async () => {
      // Two purchases long ago: a habit there was to lose.
      await allowCredit(ctx.customerId);
      for (const date of ['2026-01-10', '2026-02-10']) {
        const saleId = await sell({ customerId: ctx.customerId, price: '9000.00' });
        await prisma.documents.update({
          where: { id: saleId },
          data: { business_date: day(date) },
        });
      }
      // Someone who bought once and never came back was never a regular.
      const passer = await prisma.customers.create({
        data: { name: 'Бир жолку', ctype: 'RETAIL' },
        select: { id: true },
      });
      const onceId = await sell({
        customerId: passer.id,
        price: '1000.00',
        cost: '500.0000',
      });
      await prisma.documents.update({
        where: { id: onceId },
        data: { business_date: day('2026-01-05') },
      });

      const { body } = await customers().expect(200);
      expect(body.lapsed).toEqual([
        expect.objectContaining({
          customer_id: ctx.customerId,
          purchases: 2,
          last_purchase: '2026-02-10',
        }),
      ]);
      expect(body.lapsed_since).toBeDefined();
    });
  });
});
