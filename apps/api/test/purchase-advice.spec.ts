import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { confirmedPurchase } from './module3-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import {
  adviseQuantity,
  advicePriority,
  coverDays,
} from '../src/reports/purchase-advice-math';

const D = (value: string) => new Prisma.Decimal(value);

describe('Purchasing assistant (Module 19, §33)', () => {
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
  const flow = () => documentFlow(app, ctx.ownerToken);

  const advice = () => asOwner(http().get('/api/reports/purchase-advice'));

  async function setLevels(index: number, min: string, reorder: string) {
    await prisma.products.update({
      where: { id: ctx.productIds[index] },
      data: { min_stock: min, reorder_point: reorder },
    });
  }

  /** Sells `qty` on a given day, so a rate can be measured from it. */
  async function sellOn(params: {
    productIndex?: number;
    qty: string;
    price: string;
    date: string;
  }) {
    await stockLayer(app, prisma, ctx, {
      productIndex: params.productIndex ?? 0,
      qty: params.qty,
      unitCost: '1000.0000',
    });
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[params.productIndex ?? 0],
            qty: params.qty,
            final_price: params.price,
          },
        ],
        payments: [
          {
            account_id: ctx.sellerCash,
            amount: D(params.qty).times(params.price).toFixed(2),
          },
        ],
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);
    await prisma.documents.update({
      where: { id: draft.id },
      data: { business_date: new Date(`${params.date}T00:00:00.000Z`) },
    });
  }

  describe('The suggestion, stated as arithmetic (§33)', () => {
    it('follows §33’s own example: 12 on the shelf, 18 a month, 30 days out', () => {
      // 18 a month is 0.6 a day. 30 days of waiting plus 60 of cover is 90
      // days, which will take 54; 12 are on the shelf, so 42 are wanted.
      const result = adviseQuantity({
        dailyRate: D('0.6'),
        leadDays: 30,
        coverDays: 60,
        available: D('12'),
        inbound: D('0'),
        reserved: D('0'),
        minStock: D('0'),
      });
      expect(result.needed).toBe('54.00');
      expect(result.suggested).toBe('42');
      expect(result.cover_days).toBe('20.0');
    });

    it('does not order what is already on its way (§12-Б.4)', () => {
      const result = adviseQuantity({
        dailyRate: D('0.6'),
        leadDays: 30,
        coverDays: 60,
        available: D('12'),
        inbound: D('40'),
        reserved: D('0'),
        minStock: D('0'),
      });
      expect(result.suggested).toBe('2');
    });

    it('treats a reservation as demand, not as stock (§17)', () => {
      const held = adviseQuantity({
        dailyRate: D('0'),
        leadDays: 30,
        coverDays: 60,
        available: D('0'),
        inbound: D('0'),
        reserved: D('3'),
        minStock: D('0'),
      });
      expect(held.suggested).toBe('3');
    });

    it('never suggests a negative order, and rounds up to whole units', () => {
      expect(
        adviseQuantity({
          dailyRate: D('0.1'),
          leadDays: 10,
          coverDays: 10,
          available: D('100'),
          inbound: D('0'),
          reserved: D('0'),
          minStock: D('0'),
        }).suggested,
      ).toBe('0');
      expect(
        adviseQuantity({
          dailyRate: D('0.5'),
          leadDays: 1,
          coverDays: 2,
          available: D('0'),
          inbound: D('0'),
          reserved: D('0'),
          minStock: D('0'),
        }).suggested,
      ).toBe('2');
    });

    it('never lets a slow month argue away the OWNER’s minimum (§12-Б.4)', () => {
      const result = adviseQuantity({
        dailyRate: D('0'),
        leadDays: 30,
        coverDays: 60,
        available: D('2'),
        inbound: D('0'),
        reserved: D('0'),
        minStock: D('10'),
      });
      expect(result.needed).toBe('10.00');
      expect(result.suggested).toBe('8');
    });

    it('has no cover period for something that never sells', () => {
      expect(coverDays(D('50'), D('0'))).toBeNull();
      expect(coverDays(D('50'), D('2'))).toBe('25.0');
    });

    it('is urgent when it runs out before an order could arrive (§33)', () => {
      const lead = 30;
      expect(
        advicePriority({ suggested: '10', coverDays: '20.0', leadDays: lead, abc: 'C' }),
      ).toBe('URGENT');
      expect(
        advicePriority({ suggested: '10', coverDays: '45.0', leadDays: lead, abc: 'C' }),
      ).toBe('SOON');
      // What earns most breaks the tie, it does not decide it.
      expect(
        advicePriority({ suggested: '10', coverDays: '200.0', leadDays: lead, abc: 'A' }),
      ).toBe('SOON');
      expect(
        advicePriority({ suggested: '10', coverDays: '200.0', leadDays: lead, abc: 'C' }),
      ).toBe('LATER');
      expect(
        advicePriority({ suggested: '0', coverDays: '5.0', leadDays: lead, abc: 'A' }),
      ).toBe('HOLD');
    });
  });

  describe('What it measures (§6, §33)', () => {
    it('says the lead time is unknown rather than guessing one', async () => {
      const { body } = await advice().expect(200);
      expect(body.lead_days).toBeNull();
      expect(body.lead_days_source).toBe('UNKNOWN');
      expect(body.batches_measured).toBe(0);
    });

    it('takes the OWNER’s figure until a batch has been timed', async () => {
      await asOwner(http().put('/api/settings/purchase.fallback_lead_days'))
        .send({ value: 45 })
        .expect(200);

      const { body } = await advice().expect(200);
      expect(body.lead_days).toBe(45);
      expect(body.lead_days_source).toBe('SETTING');
    });

    it('measures the delivery time from order to receipt (§6, §7)', async () => {
      const purchaseId = await confirmedPurchase(app, ctx, {
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
        buyCny: { amount: '2000.00', rate: '13.00' },
      });
      const { body: receipt } = await asOwner(http().post('/api/receipts'))
        .send({ purchase_id: purchaseId })
        .expect(201);
      await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
        .send({ rate_cny: '13.000000' })
        .expect(201);
      await flow().confirm(receipt.id).expect(201);

      // The order went out 20 days before the goods were received.
      const ordered = new Date();
      ordered.setUTCDate(ordered.getUTCDate() - 20);
      await prisma.documents.update({
        where: { id: purchaseId },
        data: { business_date: ordered },
      });

      const { body } = await advice().expect(200);
      expect(body.lead_days).toBe(20);
      expect(body.lead_days_source).toBe('MEASURED');
      expect(body.batches_measured).toBe(1);
    });
  });

  describe('The advice itself (§33)', () => {
    it('suggests what the wait and the cover period will consume', async () => {
      await asOwner(http().put('/api/settings/purchase.fallback_lead_days'))
        .send({ value: 30 })
        .expect(200);
      await asOwner(http().put('/api/settings/purchase.cover_days'))
        .send({ value: 60 })
        .expect(200);
      await setLevels(0, '5.00', '10.00');

      // 30 sold over the last 30 days, 12 left on the shelf.
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 29);
      await sellOn({
        qty: '30.00',
        price: '2000.00',
        date: start.toISOString().slice(0, 10),
      });
      await stockLayer(app, prisma, ctx, { qty: '12.00', unitCost: '1000.0000' });

      const { body } = await advice().expect(200);
      const line = body.order.find(
        (row: { product_id: string }) => row.product_id === ctx.productIds[0],
      );
      expect(line.available).toBe('12.00');
      expect(line.monthly_rate).toBe('30.00');
      expect(line.lead_days).toBe(30);
      // A day's rate of 1.0 over 90 days is 90, less the 12 on the shelf.
      expect(line.suggested).toBe('78');
      expect(line.priority).toBe('URGENT');
      expect(line.reason).toMatch(/жеткирүү 30 күн/);
    });

    it('holds back what is already covered, and says why', async () => {
      await asOwner(http().put('/api/settings/purchase.fallback_lead_days'))
        .send({ value: 30 })
        .expect(200);
      await setLevels(0, '5.00', '10.00');
      // Barely sells, and the shelf is full.
      await stockLayer(app, prisma, ctx, { qty: '500.00', unitCost: '1000.0000' });

      const { body } = await advice().expect(200);
      const held = body.hold.find(
        (row: { product_id: string }) => row.product_id === ctx.productIds[0],
      );
      expect(held.suggested).toBe('0');
      expect(held.priority).toBe('HOLD');
      expect(held.reason).toMatch(/азырынча заказ керек эмес/);
      expect(
        body.order.find(
          (row: { product_id: string }) => row.product_id === ctx.productIds[0],
        ),
      ).toBeUndefined();
    });

    it('prices the order in yuan and weighs it against the till (§33)', async () => {
      await asOwner(http().put('/api/settings/purchase.fallback_lead_days'))
        .send({ value: 30 })
        .expect(200);
      // Nothing has sold, so what pulls this in is the minimum (§12-Б.4):
      // 50 wanted, 10 already on their way, so 40 to order.
      await setLevels(0, '50.00', '0.00');
      await confirmedPurchase(app, ctx, {
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
        buyCny: { amount: '2000.00', rate: '13.00' },
      });

      const { body } = await advice().expect(200);
      const line = body.order.find(
        (row: { product_id: string }) => row.product_id === ctx.productIds[0],
      );
      expect(line.suggested).toBe('40');
      expect(line.last_price_cny).toBe('100.00');
      expect(line.supplier_name).toBeDefined();
      expect(line.estimated_cost_cny).toBe(
        D(line.suggested).times('100.00').toFixed(2),
      );

      expect(body.budget.estimated_cny).toBe(line.estimated_cost_cny);
      expect(body.budget.available_cny).toBe('2000.00');
      // The till holds 2 000 CNY; anything above that is a shortfall.
      expect(body.budget.shortfall_cny).toBe(
        D(body.budget.estimated_cny).minus('2000.00').greaterThan(0)
          ? D(body.budget.estimated_cny).minus('2000.00').toFixed(2)
          : '0.00',
      );
    });

    it('carries the ABC and XYZ classes onto the line (§29)', async () => {
      await asOwner(http().put('/api/settings/purchase.fallback_lead_days'))
        .send({ value: 30 })
        .expect(200);
      await setLevels(0, '50.00', '0.00');
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 10);
      await sellOn({
        qty: '5.00',
        price: '2000.00',
        date: start.toISOString().slice(0, 10),
      });

      const { body } = await advice().expect(200);
      const line = body.order.find(
        (row: { product_id: string }) => row.product_id === ctx.productIds[0],
      );
      expect(line.abc).toBe('A');
      expect(line.margin_pct).toBeDefined();
    });

    it('is the OWNER’s to see (§2)', async () => {
      await asStaff(http().get('/api/reports/purchase-advice')).expect(403);
      await asOwner(http().get('/api/reports/purchase-advice')).expect(200);
    });
  });
});
