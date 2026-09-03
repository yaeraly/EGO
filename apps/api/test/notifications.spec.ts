import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AlertsService } from '../src/notifications/alerts.service';
import { createTestApp } from './app-harness';
import {
  Module2Context,
  buyCurrency,
  documentFlow,
  resetModule2,
  shipPurchase,
} from './module2-harness';

describe('Notifications and alerts (Module 2.7, §39)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let alerts: AlertsService;
  let ctx: Module2Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    alerts = app.get(AlertsService);
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

  async function withYuan(cny = '3000.00', rate = '13.00'): Promise<void> {
    await buyCurrency(app, ctx, {
      kgs: new Prisma.Decimal(rate).times(cny).toFixed(2),
      foreign: cny,
      toAccount: ctx.cnyAccount,
    });
  }

  /**
   * An order shipped from the supplier is what puts us into debt (§4.2,
   * §6.1) — the order alone owes nobody anything.
   */
  async function owedToSupplier(totalCny: string): Promise<string> {
    const flow = documentFlow(app, ctx.ownerToken);
    const { id } = await flow.createAndConfirm('/api/purchases', {
      supplier_id: ctx.supplierId,
      cargo_company_id: ctx.cargoCompanyId,
      items: [
        { product_id: ctx.productIds[0], qty: '1.00', price_cny: totalCny },
      ],
    });
    await shipPurchase(app, ctx.ownerToken, id);
    return id;
  }

  const setThreshold = (key: string, value: number | null) =>
    asOwner(http().put(`/api/settings/${key}`)).send({ value });

  const ownerAlerts = async () => {
    const { body } = await asOwner(http().get('/api/notifications')).expect(200);
    return body.items as { kind: string; title: string; body: string; payload: any }[];
  };

  describe('supplier debt digest (§4.3, §39)', () => {
    it('raises nothing when no supplier is owed', async () => {
      const result = await alerts.runDailyDigest();

      expect(result.supplier_debt).toEqual({
        raised: false,
        suppliers: 0,
        total_cny: '0.00',
      });
      expect(await ownerAlerts()).toEqual([]);
    });

    it('alerts the OWNER with the amount owed', async () => {
      await withYuan();
      await owedToSupplier('1500.00');

      const result = await alerts.runDailyDigest();

      expect(result.supplier_debt).toMatchObject({
        raised: true,
        suppliers: 1,
        total_cny: '1500.00',
      });

      const [alert] = await ownerAlerts();
      expect(alert.kind).toBe('SUPPLIER_DEBT');
      expect(alert.title).toContain('1500.00 CNY');
      expect(alert.body).toContain('Yiwu Partner');
      expect(alert.payload.suppliers[0].amount_cny).toBe('1500.00');
    });

    it('does not repeat the same alert on a second run the same day', async () => {
      await withYuan();
      await owedToSupplier('1500.00');

      const first = await alerts.runDailyDigest();
      const second = await alerts.runDailyDigest();

      expect(first.supplier_debt.raised).toBe(true);
      // The debt is still reported; the alert is simply not raised twice.
      expect(second.supplier_debt).toMatchObject({
        raised: false,
        suppliers: 1,
        total_cny: '1500.00',
      });
      expect(await ownerAlerts()).toHaveLength(1);
    });

    it('raises a fresh alert on the next day', async () => {
      await withYuan();
      await owedToSupplier('1500.00');

      await alerts.runDailyDigest(new Date('2026-08-30T06:00:00Z'));
      await alerts.runDailyDigest(new Date('2026-08-31T06:00:00Z'));

      const items = await ownerAlerts();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.payload.date).sort()).toEqual([
        '2026-08-30',
        '2026-08-31',
      ]);
    });

    it('stops alerting once the debt is settled', async () => {
      await withYuan();
      await owedToSupplier('1500.00');

      const flow = documentFlow(app, ctx.ownerToken);
      await flow.createAndConfirm('/api/supplier-payments', {
        supplier_id: ctx.supplierId,
        from_account: ctx.cnyAccount,
        amount_cny: '1500.00',
      });

      const result = await alerts.runDailyDigest();

      expect(result.supplier_debt.raised).toBe(false);
      expect(result.supplier_debt.suppliers).toBe(0);
      expect(await ownerAlerts()).toEqual([]);
    });

    it('does not alert on a supplier holding our advance', async () => {
      await withYuan();
      const flow = documentFlow(app, ctx.ownerToken);
      await flow.createAndConfirm('/api/supplier-payments', {
        supplier_id: ctx.supplierId,
        from_account: ctx.cnyAccount,
        amount_cny: '500.00',
      });

      const result = await alerts.runDailyDigest();

      expect(result.supplier_debt.suppliers).toBe(0);
    });
  });

  describe('cargo debt digest (§5.2, §39)', () => {
    it('raises nothing while no cargo cost is recognised', async () => {
      // Until Receipt (Module 3) recognises the carrier's bill there is
      // nothing owed, so a payment made now is a deposit, not a debt.
      await buyCurrency(app, ctx, {
        kgs: '87000.00',
        foreign: '1000.00',
        toAccount: ctx.usdAccount,
      });
      const flow = documentFlow(app, ctx.ownerToken);
      await flow.createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.usdAccount,
        amount: '400.00',
      });

      const result = await alerts.runDailyDigest();

      expect(result.cargo_debt).toEqual({
        raised: false,
        companies: 0,
        total_usd: '0.00',
      });
    });

    it('alerts the OWNER once a carrier is owed', async () => {
      await withYuan();
      // Module 3's Receipt is what recognises the carrier's bill; until it
      // exists, the entry is written directly against the shipment's own
      // document, so the "every movement belongs to a document" rule holds.
      const purchaseId = await owedToSupplier('1000.00');

      await prisma.cargo_ledger.create({
        data: {
          cargo_company_id: ctx.cargoCompanyId,
          document_id: purchaseId,
          entry_type: 'PAYABLE',
          amount_usd: new Prisma.Decimal('-320.00'),
          kgs_value: new Prisma.Decimal('-27840.00'),
        },
      });

      const result = await alerts.runDailyDigest();

      expect(result.cargo_debt).toMatchObject({
        raised: true,
        companies: 1,
        total_usd: '320.00',
      });

      const [alert] = await ownerAlerts();
      expect(alert.kind).toBe('CARGO_DEBT');
      expect(alert.title).toContain('320.00 USD');
      expect(alert.body).toContain('Silk Road Cargo');
    });
  });

  describe('low currency balance (§39)', () => {
    it('stays quiet while no threshold is configured', async () => {
      await withYuan('100.00', '13.00');

      const result = await alerts.runDailyDigest();

      expect(result.low_balance).toEqual([]);
      expect(await ownerAlerts()).toEqual([]);
    });

    it('warns when the till is below the threshold', async () => {
      await withYuan('100.00', '13.00');
      await setThreshold('alerts.low_balance_threshold.cny', 500).expect(200);

      const result = await alerts.runDailyDigest();

      expect(result.low_balance).toEqual([
        {
          account_id: ctx.cnyAccount,
          name: 'CNY Cash',
          currency: 'CNY',
          balance: '100.00',
          threshold: '500.00',
          raised: true,
        },
      ]);

      const [alert] = await ownerAlerts();
      expect(alert.kind).toBe('LOW_CURRENCY_BALANCE');
      expect(alert.body).toContain('CEX');
      expect(alert.payload.balance).toBe('100.00');
    });

    it('stays quiet once the till is at the threshold', async () => {
      await withYuan('500.00', '13.00');
      await setThreshold('alerts.low_balance_threshold.cny', 500).expect(200);

      const result = await alerts.runDailyDigest();

      expect(result.low_balance).toEqual([]);
    });

    it('never warns about a KGS account — the threshold is per currency', async () => {
      await setThreshold('alerts.low_balance_threshold.cny', 500).expect(200);
      await setThreshold('alerts.low_balance_threshold.usd', 500).expect(200);

      const result = await alerts.runDailyDigest();

      expect(
        result.low_balance.map((row) => row.currency).sort(),
      ).toEqual(['CNY', 'USD']);
    });

    it('raises one alert per till, deduped per till per day', async () => {
      await withYuan('100.00', '13.00');
      await setThreshold('alerts.low_balance_threshold.cny', 500).expect(200);
      await setThreshold('alerts.low_balance_threshold.usd', 50).expect(200);

      await alerts.runDailyDigest();
      await alerts.runDailyDigest();

      const items = await ownerAlerts();
      expect(items.filter((i) => i.kind === 'LOW_CURRENCY_BALANCE')).toHaveLength(2);
    });
  });

  describe('the notification list', () => {
    it('shows a user only their own alerts', async () => {
      await withYuan();
      await owedToSupplier('1500.00');
      await alerts.runDailyDigest();

      const { body: staffView } = await asStaff(
        http().get('/api/notifications'),
      ).expect(200);

      expect(staffView.items).toEqual([]);
      expect(staffView.unread_count).toBe(0);
      expect((await ownerAlerts()).length).toBe(1);
    });

    it('counts and clears unread alerts', async () => {
      await withYuan();
      await owedToSupplier('1500.00');
      await alerts.runDailyDigest();

      const { body: before } = await asOwner(http().get('/api/notifications')).expect(200);
      expect(before.unread_count).toBe(1);

      await asOwner(http().post('/api/notifications/read-all')).expect(201);

      const { body: after } = await asOwner(http().get('/api/notifications')).expect(200);
      expect(after.unread_count).toBe(0);
      expect(after.items).toHaveLength(1);
      expect(after.items[0].read_at).not.toBeNull();
    });

    it('filters to unread only when asked', async () => {
      await withYuan();
      await owedToSupplier('1500.00');
      await alerts.runDailyDigest();
      await asOwner(http().post('/api/notifications/read-all')).expect(201);

      const { body } = await asOwner(
        http().get('/api/notifications?unread=true'),
      ).expect(200);

      expect(body.items).toEqual([]);
    });

    it('marks one alert read', async () => {
      await withYuan();
      await owedToSupplier('1500.00');
      await alerts.runDailyDigest();

      const { body } = await asOwner(http().get('/api/notifications')).expect(200);
      const id = body.items[0].id;

      await asOwner(http().post(`/api/notifications/${id}/read`)).expect(201);

      expect((await asOwner(http().get('/api/notifications'))).body.unread_count).toBe(0);
    });

    it('refuses to mark another user\'s alert read', async () => {
      await withYuan();
      await owedToSupplier('1500.00');
      await alerts.runDailyDigest();

      const { body } = await asOwner(http().get('/api/notifications')).expect(200);
      const id = body.items[0].id;

      await asStaff(http().post(`/api/notifications/${id}/read`)).expect(404);

      expect((await asOwner(http().get('/api/notifications'))).body.unread_count).toBe(1);
    });

    it('needs a token', async () => {
      await http().get('/api/notifications').expect(401);
    });
  });

  describe('running the digest on demand', () => {
    it('is an OWNER action', async () => {
      await asStaff(http().post('/api/notifications/run-digest')).expect(403);
    });

    it('reports what it found without raising anything twice', async () => {
      await withYuan();
      await owedToSupplier('1500.00');

      const { body: first } = await asOwner(
        http().post('/api/notifications/run-digest'),
      ).expect(201);
      const { body: second } = await asOwner(
        http().post('/api/notifications/run-digest'),
      ).expect(201);

      expect(first.supplier_debt.raised).toBe(true);
      expect(second.supplier_debt.raised).toBe(false);
      expect(second.supplier_debt.total_cny).toBe('1500.00');
      expect(await ownerAlerts()).toHaveLength(1);
    });
  });
});
