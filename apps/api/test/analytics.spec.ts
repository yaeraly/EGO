import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import {
  classifyAbc,
  classifyXyz,
  coefficientOfVariation,
  marginPct,
} from '../src/reports/analytics-math';

const D = (value: string) => new Prisma.Decimal(value);

describe('Analytical reports (Module 16, §29)', () => {
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
  const flow = () => documentFlow(app, ctx.ownerToken);

  const productsReport = () =>
    asOwner(http().get('/api/reports/products')).query({
      from: '2026-01-01',
      to: today,
    });

  /** Sells `qty` of one product at `price`, from a layer costing `cost`. */
  async function sell(params: {
    productIndex?: number;
    qty: string;
    price: string;
    cost?: string;
  }): Promise<{ saleId: string; itemId: string }> {
    await stockLayer(app, prisma, ctx, {
      productIndex: params.productIndex ?? 0,
      qty: params.qty,
      unitCost: params.cost ?? '1000.0000',
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
    const item = await prisma.sale_items.findFirstOrThrow({
      where: { sale_id: draft.id },
    });
    return { saleId: draft.id as string, itemId: item.id };
  }

  describe('The classification, stated on its own', () => {
    it('puts the few that earn most of the money in class A (§29)', () => {
      const rows = [
        { id: 'a', revenue: D('800.00') },
        { id: 'b', revenue: D('150.00') },
        { id: 'c', revenue: D('40.00') },
        { id: 'd', revenue: D('10.00') },
      ];
      const ranked = classifyAbc(rows, (row) => row.revenue, {
        aPct: D('80'),
        bPct: D('95'),
      });

      // 'a' alone is 80% of the money; 'b' takes the running total to 95%.
      // 'c' starts at 95% exactly, so it is already past class B.
      expect(ranked.map((entry) => [entry.row.id, entry.abc])).toEqual([
        ['a', 'A'],
        ['b', 'B'],
        ['c', 'C'],
        ['d', 'C'],
      ]);
      expect(ranked[0].share_pct).toBe('80.00');
      expect(ranked[1].cumulative_pct).toBe('95.00');
    });

    it('ranks by value, whatever order it was given in', () => {
      const rows = [
        { id: 'small', revenue: D('10.00') },
        { id: 'big', revenue: D('990.00') },
      ];
      const ranked = classifyAbc(rows, (row) => row.revenue, {
        aPct: D('80'),
        bPct: D('95'),
      });
      expect(ranked[0].row.id).toBe('big');
      expect(ranked[0].abc).toBe('A');
      expect(ranked[1].abc).toBe('C');
    });

    it('calls everything C when nothing was earned', () => {
      const ranked = classifyAbc(
        [{ id: 'a', revenue: D('0.00') }],
        (row) => row.revenue,
        { aPct: D('80'), bPct: D('95') },
      );
      expect(ranked[0].abc).toBe('C');
      expect(ranked[0].share_pct).toBe('0.00');
    });

    it('measures how much demand moves about, in percent of its average', () => {
      // Steady: 10, 10, 10 → no variation at all.
      expect(coefficientOfVariation([D('10'), D('10'), D('10')])!.toFixed(2)).toBe(
        '0.00',
      );
      // Erratic: 1, 19 → mean 10, deviation 9, so 90%.
      expect(coefficientOfVariation([D('1'), D('19')])!.toFixed(2)).toBe('90.00');
    });

    it('says nothing when there is nothing to measure', () => {
      // One month is not evidence of steadiness.
      expect(coefficientOfVariation([D('10')])).toBeNull();
      expect(coefficientOfVariation([])).toBeNull();
      expect(coefficientOfVariation([D('0'), D('0')])).toBeNull();
      expect(classifyXyz(null, { xPct: D('10'), yPct: D('25') })).toBeNull();
    });

    it('sorts steady demand into X and erratic into Z', () => {
      const bands = { xPct: D('10'), yPct: D('25') };
      expect(classifyXyz(D('0'), bands)).toBe('X');
      expect(classifyXyz(D('10'), bands)).toBe('X');
      expect(classifyXyz(D('10.01'), bands)).toBe('Y');
      expect(classifyXyz(D('25'), bands)).toBe('Y');
      expect(classifyXyz(D('25.01'), bands)).toBe('Z');
    });

    it('takes the margin as a share of what was charged, not of cost', () => {
      expect(marginPct(D('1000.00'), D('250.00'))).toBe('25.00');
      // Sold for nothing is not "0% margin"; it is no margin to speak of.
      expect(marginPct(D('0.00'), D('0.00'))).toBeNull();
    });
  });

  describe('By product: ABC, margin and what sold (§29)', () => {
    it('ranks products by what they brought in, with each one’s margin', async () => {
      await sell({ productIndex: 0, qty: '10.00', price: '9000.00', cost: '4000.0000' });
      await sell({ productIndex: 1, qty: '1.00', price: '2000.00', cost: '1000.0000' });

      const { body } = await productsReport().expect(200);
      expect(body.products).toHaveLength(2);

      const [first, second] = body.products;
      expect(first.sku).toBeDefined();
      expect(first.revenue).toBe('90000.00');
      expect(first.cogs).toBe('40000.00');
      expect(first.margin).toBe('50000.00');
      expect(first.margin_pct).toBe('55.56');
      expect(first.abc).toBe('A');
      expect(second.revenue).toBe('2000.00');
      expect(second.abc).toBe('C');

      expect(body.totals.revenue).toBe('92000.00');
      expect(body.totals.margin).toBe('51000.00');
    });

    it('counts a returned unit as never sold (§35.7)', async () => {
      const { itemId, saleId } = await sell({
        qty: '5.00',
        price: '9000.00',
        cost: '4000.0000',
      });

      const before = await productsReport().expect(200);
      expect(before.body.products[0].qty).toBe('5.00');
      expect(before.body.products[0].revenue).toBe('45000.00');

      const { body: draft } = await asStaff(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Экөө жарабай калды',
          items: [{ sale_item_id: itemId, qty: '2.00', condition: 'RESALABLE' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/returns/${draft.id}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '18000.00' }],
        })
        .expect(201);

      const after = await productsReport().expect(200);
      expect(after.body.products[0].qty).toBe('3.00');
      expect(after.body.products[0].revenue).toBe('27000.00');
      expect(after.body.products[0].cogs).toBe('12000.00');
    });

    it('shows which cut-offs it used, so nobody mistakes them for a rule', async () => {
      const { body } = await productsReport().expect(200);
      expect(body.thresholds).toEqual({
        abc_a_pct: '80.00',
        abc_b_pct: '95.00',
        xyz_x_pct: '10.00',
        xyz_y_pct: '25.00',
      });
    });

    it('follows the cut-offs the OWNER sets', async () => {
      await sell({ productIndex: 0, qty: '10.00', price: '9000.00' });
      await sell({ productIndex: 1, qty: '1.00', price: '2000.00' });

      await asOwner(http().put('/api/settings/analytics.abc.a_threshold_pct'))
        .send({ value: 99 })
        .expect(200);

      const { body } = await productsReport().expect(200);
      expect(body.thresholds.abc_a_pct).toBe('99.00');
      // With A reaching to 99%, the small product is inside it now.
      expect(body.products.map((p: { abc: string }) => p.abc)).toEqual(['A', 'A']);
    });

    it('leaves XYZ unset when one month is all there is', async () => {
      await sell({ qty: '3.00', price: '9000.00' });

      const { body } = await productsReport().expect(200);
      expect(body.products[0].months).toBe(1);
      expect(body.products[0].xyz).toBeNull();
      expect(body.products[0].variation_pct).toBeNull();
    });
  });

  describe('Sales over time (§29)', () => {
    it('adds up by day, and by month', async () => {
      await sell({ qty: '2.00', price: '9000.00', cost: '4000.0000' });

      const daily = await asOwner(http().get('/api/reports/sales-trend'))
        .query({ bucket: 'day', from: '2026-01-01', to: today })
        .expect(200);
      expect(daily.body.bucket).toBe('day');
      expect(daily.body.points).toEqual([
        expect.objectContaining({
          bucket: today,
          sales: 1,
          revenue: '18000.00',
          margin: '10000.00',
        }),
      ]);

      const monthly = await asOwner(http().get('/api/reports/sales-trend'))
        .query({ bucket: 'month', from: '2026-01-01', to: today })
        .expect(200);
      expect(monthly.body.points).toHaveLength(1);
      expect(monthly.body.points[0].bucket).toBe(`${today.slice(0, 8)}01`);
    });

    it('falls back to days when asked for something it does not have', async () => {
      const { body } = await asOwner(http().get('/api/reports/sales-trend'))
        .query({ bucket: 'century' })
        .expect(200);
      expect(body.bucket).toBe('day');
    });
  });

  describe('What needs ordering (§29, §12-Б.4)', () => {
    async function setLevels(index: number, min: string, reorder: string) {
      await prisma.products.update({
        where: { id: ctx.productIds[index] },
        data: { min_stock: min, reorder_point: reorder },
      });
    }

    it('lists a product that has fallen below its minimum', async () => {
      await setLevels(0, '5.00', '8.00');
      await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '1000.0000' });

      const { body } = await asOwner(http().get('/api/reports/reorder')).expect(200);
      const row = body.products.find(
        (p: { product_id: string }) => p.product_id === ctx.productIds[0],
      );
      expect(row).toMatchObject({
        on_hand: '2.00',
        available: '2.00',
        min_stock: '5.00',
        reason: 'BELOW_MINIMUM',
      });
    });

    it('leaves a well-stocked product alone', async () => {
      await setLevels(0, '2.00', '3.00');
      await stockLayer(app, prisma, ctx, { qty: '20.00', unitCost: '1000.0000' });

      const { body } = await asOwner(http().get('/api/reports/reorder')).expect(200);
      expect(
        body.products.find(
          (p: { product_id: string }) => p.product_id === ctx.productIds[0],
        ),
      ).toBeUndefined();
    });

    it('counts reserved goods as gone, because they are (§17)', async () => {
      await setLevels(0, '3.00', '0.00');
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '1000.0000' });

      const clear = await asOwner(http().get('/api/reports/reorder')).expect(200);
      expect(
        clear.body.products.find(
          (p: { product_id: string }) => p.product_id === ctx.productIds[0],
        ),
      ).toBeUndefined();

      const { id } = await flow().createAndConfirm('/api/reservations', {
        customer_id: ctx.customerId,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        items: [{ product_id: ctx.productIds[0], qty: '3.00' }],
      });
      expect(id).toBeDefined();

      const { body } = await asOwner(http().get('/api/reports/reorder')).expect(200);
      const row = body.products.find(
        (p: { product_id: string }) => p.product_id === ctx.productIds[0],
      );
      expect(row).toMatchObject({
        on_hand: '5.00',
        reserved: '3.00',
        available: '2.00',
        reason: 'BELOW_MINIMUM',
      });
    });

    it('shows what is already on its way rather than subtracting it', async () => {
      await setLevels(0, '5.00', '0.00');
      // §10.1: an order cannot be priced in som without a rate to price it at.
      await asOwner(http().put('/api/settings/fx.manual_reference_rate.cny'))
        .send({ value: 13 })
        .expect(200);
      await flow().createAndConfirm('/api/purchases', {
        supplier_id: ctx.supplierId,
        cargo_company_id: ctx.cargoCompanyId,
        items: [
          { product_id: ctx.productIds[0], qty: '20.00', price_cny: '100.00' },
        ],
      });

      const { body } = await asOwner(http().get('/api/reports/reorder')).expect(200);
      const row = body.products.find(
        (p: { product_id: string }) => p.product_id === ctx.productIds[0],
      );
      // Still listed: whether 20 on the way is enough is the buyer's call.
      expect(row.inbound).toBe('20.00');
      expect(row.available).toBe('0.00');
    });
  });

  describe('Who may read them (§2)', () => {
    it('is the OWNER’s picture of the business', async () => {
      await asStaff(http().get('/api/reports/products')).expect(403);
      await asStaff(http().get('/api/reports/sales-trend')).expect(403);
      await asStaff(http().get('/api/reports/reorder')).expect(403);
      await asOwner(http().get('/api/reports/reorder')).expect(200);
    });
  });
});
