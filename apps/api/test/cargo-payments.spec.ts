import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import {
  Module2Context,
  buyCurrency,
  documentFlow,
  resetModule2,
} from './module2-harness';

const D = (value: string) => new Prisma.Decimal(value);

describe('Cargo ledger and payments (Module 2.6)', () => {
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

  const buyUsd = (usd: string, rate: string) =>
    buyCurrency(app, ctx, {
      kgs: D(usd).times(rate).toFixed(2),
      foreign: usd,
      toAccount: ctx.usdAccount,
    });

  const fundKgs = (amount: string) =>
    flow().createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: ctx.kgsAccount,
      amount,
    });

  const cargoLedger = async (): Promise<{
    balance_usd: string;
    on_deposit_usd: string;
    we_owe_usd: string;
  }> => {
    const res = await asOwner(
      http().get(`/api/cargo-companies/${ctx.cargoCompanyId}/ledger`),
    ).expect(200);
    return res.body;
  };

  describe('paying from a USD till (§5.2)', () => {
    it('draws the dollars off the currency FIFO', async () => {
      await buyUsd('1000.00', '87.80');

      const { id } = await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.usdAccount,
        amount: '400.00',
      });

      const stored = await prisma.cargo_payments.findUnique({
        where: { document_id: id },
      });
      expect(stored?.currency).toBe('USD');
      expect(stored?.amount.toFixed(2)).toBe('400.00');
      // 400 x 87.80
      expect(stored?.kgs_value.toFixed(2)).toBe('35120.00');
      expect(stored?.rate?.toFixed(2)).toBe('87.80');

      const consumption = await prisma.currency_layer_consumptions.findFirst({
        where: { document_id: id },
      });
      expect(consumption?.amount.toFixed(2)).toBe('400.00');
    });

    it('records the real rate when the dollars came from two layers', async () => {
      await buyUsd('500.00', '87.00');
      await buyUsd('500.00', '89.00');

      const { id } = await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.usdAccount,
        amount: '1000.00',
      });

      const stored = await prisma.cargo_payments.findUnique({
        where: { document_id: id },
      });
      // 500x87 + 500x89 = 88 000; the real rate is the average, 88.00
      expect(stored?.kgs_value.toFixed(2)).toBe('88000.00');
      expect(stored?.rate?.toFixed(2)).toBe('88.00');
    });

    it('leaves the carrier holding a deposit while nothing is owed', async () => {
      await buyUsd('1000.00', '87.80');
      await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.usdAccount,
        amount: '400.00',
      });

      const ledger = await cargoLedger();
      // Freight cost is recognised at Receipt (Module 3), so this is a
      // deposit, not a settlement.
      expect(ledger.balance_usd).toBe('400.00');
      expect(ledger.on_deposit_usd).toBe('400.00');
      expect(ledger.we_owe_usd).toBe('0.00');
      expect(await prisma.cargo_payments.count()).toBe(1);
    });

    it('books no FX while there is no debt to measure against', async () => {
      await buyUsd('1000.00', '87.80');

      const { id } = await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.usdAccount,
        amount: '400.00',
      });

      const stored = await prisma.cargo_payments.findUnique({
        where: { document_id: id },
      });
      expect(stored?.fx_gain_loss_kgs.toFixed(2)).toBe('0.00');
    });

    it('refuses more dollars than the till holds', async () => {
      await buyUsd('300.00', '87.80');

      const { body } = await asOwner(http().post('/api/cargo-payments'))
        .send({
          cargo_company_id: ctx.cargoCompanyId,
          from_account: ctx.usdAccount,
          amount: '500.00',
        })
        .expect(201);

      const res = await asOwner(
        http().post(`/api/documents/${body.id}/confirm`),
      ).expect(409);
      expect(res.body.message).toContain('CEX');
      expect(
        await prisma.cargo_ledger.count({ where: { document_id: body.id } }),
      ).toBe(0);
    });
  });

  describe('paying in som (§5.2)', () => {
    it('requires the dollar rate', async () => {
      await fundKgs('100000.00');

      const res = await asOwner(http().post('/api/cargo-payments'))
        .send({
          cargo_company_id: ctx.cargoCompanyId,
          from_account: ctx.kgsAccount,
          amount: '35120.00',
        })
        .expect(400);

      expect(res.body.message).toContain('rate is required');
    });

    it('records the rate used and settles the equivalent in dollars', async () => {
      await fundKgs('100000.00');

      const { id } = await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.kgsAccount,
        amount: '35120.00',
        rate: '87.80',
      });

      const stored = await prisma.cargo_payments.findUnique({
        where: { document_id: id },
      });
      expect(stored?.currency).toBe('KGS');
      expect(stored?.amount.toFixed(2)).toBe('35120.00');
      expect(stored?.rate?.toFixed(2)).toBe('87.80');
      expect(stored?.kgs_value.toFixed(2)).toBe('35120.00');

      // 35 120 / 87.80 = 400.00 USD credited to the carrier.
      const ledger = await cargoLedger();
      expect(ledger.balance_usd).toBe('400.00');
    });

    it('takes the som straight from the account, with no currency layers', async () => {
      await fundKgs('100000.00');

      const { id } = await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.kgsAccount,
        amount: '35120.00',
        rate: '87.80',
      });

      expect(
        await prisma.currency_layer_consumptions.count({
          where: { document_id: id },
        }),
      ).toBe(0);

      const { body } = await asOwner(
        http().get(`/api/accounts/${ctx.kgsAccount}/balance`),
      ).expect(200);
      expect(body.balance).toBe('64880.00');
    });

    it('records the rate source in the audit log (§5.2)', async () => {
      await fundKgs('100000.00');
      await flow().createAndConfirm('/api/cargo-payments', {
        cargo_company_id: ctx.cargoCompanyId,
        from_account: ctx.kgsAccount,
        amount: '35120.00',
        rate: '87.80',
      });

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'CARGO_PAYMENT_POSTED' },
      });
      expect(audit?.new_value).toMatchObject({
        rate: '87.8',
        rate_source: 'MANUAL',
        usd_settled: '400.00',
      });
    });

    it('refuses more som than the account holds', async () => {
      await fundKgs('1000.00');

      const { body } = await asOwner(http().post('/api/cargo-payments'))
        .send({
          cargo_company_id: ctx.cargoCompanyId,
          from_account: ctx.kgsAccount,
          amount: '35120.00',
          rate: '87.80',
        })
        .expect(201);

      await asOwner(http().post(`/api/documents/${body.id}/confirm`)).expect(409);
    });
  });

  describe('validation', () => {
    it('refuses a CNY till — cargo bills in USD or som (§5.2)', async () => {
      const res = await asOwner(http().post('/api/cargo-payments'))
        .send({
          cargo_company_id: ctx.cargoCompanyId,
          from_account: ctx.cnyAccount,
          amount: '100.00',
        })
        .expect(400);
      expect(res.body.message).toContain('USD or KGS');
    });

    it('refuses a salesperson (§2)', async () => {
      await http()
        .post('/api/cargo-payments')
        .set('Authorization', `Bearer ${ctx.staffToken}`)
        .send({
          cargo_company_id: ctx.cargoCompanyId,
          from_account: ctx.usdAccount,
          amount: '100.00',
        })
        .expect(403);
    });

    it('refuses a JSON number as the amount', async () => {
      await asOwner(http().post('/api/cargo-payments'))
        .send({
          cargo_company_id: ctx.cargoCompanyId,
          from_account: ctx.usdAccount,
          amount: 100,
        })
        .expect(400);
    });

    it('refuses an unknown carrier', async () => {
      await asOwner(http().post('/api/cargo-payments'))
        .send({
          cargo_company_id: '00000000-0000-0000-0000-000000000000',
          from_account: ctx.usdAccount,
          amount: '100.00',
        })
        .expect(404);
    });
  });
});
