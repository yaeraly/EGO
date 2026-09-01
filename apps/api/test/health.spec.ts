import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { confirmedPurchase } from './module3-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import {
  behindPlan,
  claimSeverity,
  deadStockSeverity,
  monthProgressPct,
} from '../src/reports/health-rules';

const D = (value: string) => new Prisma.Decimal(value);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('Business health (Module 20, §34)', () => {
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

  const health = () => asOwner(http().get('/api/reports/health'));
  const kinds = (body: { items: { kind: string }[] }) =>
    body.items.map((item) => item.kind);
  const item = (body: { items: { kind: string }[] }, kind: string) =>
    body.items.find((row) => row.kind === kind) as never as
      | Record<string, string | number>
      | undefined;

  async function sellOn(params: { qty: string; price: string; date?: string }) {
    await stockLayer(app, prisma, ctx, {
      qty: params.qty,
      unitCost: '1000.0000',
    });
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
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
    if (params.date) {
      await prisma.documents.update({
        where: { id: draft.id },
        data: { business_date: day(params.date) },
      });
    }
    return draft.id as string;
  }

  describe('The judgements, stated on their own', () => {
    it('measures how far through the month the business is (§34)', () => {
      expect(monthProgressPct(day('2026-09-15')).toFixed(2)).toBe('50.00');
      expect(monthProgressPct(day('2026-09-30')).toFixed(2)).toBe('100.00');
      // February is shorter, so the same day is further through it.
      expect(monthProgressPct(day('2026-02-14')).toFixed(2)).toBe('50.00');
    });

    it('calls a salesperson behind only once the month has run further', () => {
      const halfway = D('50');
      expect(
        behindPlan({ achievementPct: '30.00', monthProgressPct: halfway }),
      ).toEqual({ behind: true, gapPct: '20.0' });
      expect(
        behindPlan({ achievementPct: '80.00', monthProgressPct: halfway }),
      ).toEqual({ behind: false, gapPct: '-30.0' });
      // No plan, no verdict.
      expect(
        behindPlan({ achievementPct: null, monthProgressPct: halfway }),
      ).toBeNull();
      // On the second of the month nobody is behind yet.
      expect(
        behindPlan({ achievementPct: '0.00', monthProgressPct: D('6') }),
      ).toBeNull();
    });

    it('grows louder the longer a claim stands (§8.5)', () => {
      expect(claimSeverity(5, 30)).toBe('INFO');
      expect(claimSeverity(30, 30)).toBe('WARNING');
      expect(claimSeverity(60, 30)).toBe('URGENT');
    });

    it('measures idle stock in money, not in pieces (§34)', () => {
      expect(deadStockSeverity(D('60000'), D('50000'))).toBe('WARNING');
      expect(deadStockSeverity(D('900'), D('50000'))).toBe('INFO');
    });
  });

  describe('What it asks the OWNER to do (§34)', () => {
    it('says nothing about a business with nothing wrong', async () => {
      const { body } = await health().expect(200);
      expect(body.as_of).toBe(today);
      expect(body.items).toEqual([]);
      expect(body.counts).toEqual({ urgent: 0, warning: 0, info: 0 });
    });

    it('names the debts that are late, and who owes them (§16.4)', async () => {
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '100000.00' },
      });
      await stockLayer(app, prisma, ctx, { qty: '1.00', unitCost: '1000.0000' });
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', final_price: '9000.00' },
          ],
          debt_due_date: '2026-12-31',
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);
      await prisma.sales.update({
        where: { document_id: draft.id },
        data: { debt_due_date: day('2026-01-01') },
      });

      const { body } = await health().expect(200);
      const late = item(body, 'DEBT_OVERDUE');
      expect(late).toMatchObject({
        severity: 'URGENT',
        amount: '9000.00',
        count: 1,
      });
      expect(late!.detail).toMatch(/Азамат/);
      expect(late!.link).toBe('/customers');
    });

    it('names stock that is standing still, and what it is worth (§34)', async () => {
      // On the shelf, never sold.
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '9000.0000' });

      const { body } = await health().expect(200);
      const idle = item(body, 'DEAD_STOCK');
      expect(idle).toMatchObject({ severity: 'WARNING', amount: '90000.00' });
      expect(idle!.detail).toMatch(/Бир да жолу сатылган эмес/);
    });

    it('leaves stock alone while it is still moving', async () => {
      await sellOn({ qty: '1.00', price: '9000.00' });
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '1000.0000' });

      const { body } = await health().expect(200);
      expect(kinds(body)).not.toContain('DEAD_STOCK');
    });

    it('asks for an old claim to be chased (§8.5)', async () => {
      // §8.5: a claim always answers a discrepancy, so the shortage comes first.
      const purchaseId = await confirmedPurchase(app, ctx, {
        buyCny: { amount: '200000.00', rate: '1.00' },
        lines: [{ productIndex: 0, qty: '100.00', priceCny: '1000.00' }],
      });
      const { body: receipt } = await asOwner(http().post('/api/receipts'))
        .send({ purchase_id: purchaseId })
        .expect(201);
      await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
        .send({ rate_cny: '1.000000', rate_usd: '87.000000' })
        .expect(201);
      await asOwner(http().post(`/api/receipts/${receipt.id}/lines`))
        .send({ lines: [{ product_id: ctx.productIds[0], received_qty: '90.00' }] })
        .expect(201);
      await flow().confirm(receipt.id).expect(201);
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receipt.id}`),
      ).expect(200);

      const { body: claim } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: difs[0].document_id, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);
      // It has stood for two months.
      await prisma.documents.update({
        where: { id: claim.document_id },
        data: { business_date: day('2026-06-01') },
      });

      const { body } = await health().expect(200);
      const stale = item(body, 'CLAIM_STALE');
      expect(stale).toMatchObject({ severity: 'URGENT', currency: 'CNY' });
      expect(stale!.detail).toMatch(/талап чечилген жок/);
    });

    it('says who is behind their plan, and by how much (§24)', async () => {
      await sellOn({ qty: '1.00', price: '2000.00' });
      await asOwner(http().put('/api/plans'))
        .send({
          period_year: Number(today.slice(0, 4)),
          period_month: Number(today.slice(5, 7)),
          user_id: ctx.staffId,
          revenue_target: '1000000.00',
        })
        .expect(200);

      const { body } = await health().expect(200);
      const behind = item(body, 'SELLER_BEHIND_PLAN');
      // On the first of the month it is too early to judge (§34).
      const progress = Number(body.month_progress_pct);
      if (progress < 20) {
        expect(behind).toBeUndefined();
      } else {
        expect(behind).toMatchObject({ severity: 'WARNING' });
        expect(behind!.detail).toMatch(/артта/);
      }
    });

    it('raises a cash count that did not match (§20)', async () => {
      await sellOn({ qty: '1.00', price: '9000.00' });
      await asStaff(http().post('/api/cash-handovers'))
        .send({
          from_account: ctx.sellerCash,
          to_account: ctx.kgsAccount,
          actual_amount: '8800.00',
          difference_reason: '200 сом кем чыкты',
        })
        .expect(201);

      const { body } = await health().expect(200);
      const diff = item(body, 'CASH_DIFFERENCE');
      expect(diff).toMatchObject({ severity: 'WARNING', amount: '200.00' });
      expect(diff!.link).toBe('/day-close');
    });

    it('raises a balance that does not hold (§27, §42.3)', async () => {
      // Stock conjured without a document behind it: the books cannot close.
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '4000.0000' });

      const { body } = await health().expect(200);
      const broken = item(body, 'BALANCE_DIFFERENCE');
      expect(broken).toMatchObject({ severity: 'URGENT', link: '/reports' });
      expect(broken!.detail).toMatch(/Документсиз кыймыл/);
    });

    it('puts the most pressing first, and counts each kind', async () => {
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '100000.00' },
      });
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '9000.0000' });
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', final_price: '9000.00' },
          ],
          debt_due_date: '2026-12-31',
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);
      await prisma.sales.update({
        where: { document_id: draft.id },
        data: { debt_due_date: day('2026-01-01') },
      });

      const { body } = await health().expect(200);
      expect(body.items[0].severity).toBe('URGENT');
      expect(body.counts.urgent).toBeGreaterThan(0);
      // Every item says where to go and see to it (§34).
      for (const entry of body.items) {
        expect(entry.link).toMatch(/^\//);
        expect(entry.detail.length).toBeGreaterThan(0);
      }
    });

    it('is the OWNER’s board (§2, §34)', async () => {
      await asStaff(http().get('/api/reports/health')).expect(403);
      await asOwner(http().get('/api/reports/health')).expect(200);
    });
  });
});
