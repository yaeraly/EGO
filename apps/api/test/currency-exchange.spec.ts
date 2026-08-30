import { INestApplication } from '@nestjs/common';
import { PrismaClient, doc_status } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { BUSINESS_DATE, Module1Context, resetModule1 } from './module1-harness';

describe('Currency exchange (Module 1.3, criteria 2 and 4)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Omit<Module1Context, 'app' | 'prisma'>;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule1(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const confirm = (id: string) =>
    asOwner(http().post(`/api/documents/${id}/confirm`));

  const balance = async (accountId: string): Promise<string> => {
    const { body } = await asOwner(
      http().get(`/api/accounts/${accountId}/balance`),
    ).expect(200);
    return body.balance as string;
  };

  async function contributeCapital(
    accountId: string,
    amount: string,
    rate?: string,
  ): Promise<void> {
    const { body } = await asOwner(http().post('/api/capital'))
      .send({
        source: 'OWNER',
        account_id: accountId,
        amount,
        rate,
        business_date: BUSINESS_DATE,
      })
      .expect(201);
    await confirm(body.id).expect(201);
  }

  const draftExchange = (payload: Record<string, unknown>) =>
    asOwner(http().post('/api/currency-exchanges')).send({
      business_date: BUSINESS_DATE,
      ...payload,
    });

  async function buy(givenKgs: string, receivedCny: string): Promise<string> {
    const { body } = await draftExchange({
      from_account: ctx.kgsAccount,
      to_account: ctx.cnyAccount,
      given_amount: givenKgs,
      received_amount: receivedCny,
    }).expect(201);
    await confirm(body.id).expect(201);
    return body.id as string;
  }

  describe('buying currency with KGS', () => {
    it('moves both sides and records the derived rate', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');

      const id = await buy('130000.00', '10000.00');

      expect(await balance(ctx.kgsAccount)).toBe('70000.00');
      expect(await balance(ctx.cnyAccount)).toBe('10000.00');

      const exchange = await prisma.currency_exchanges.findUnique({
        where: { document_id: id },
      });
      expect(exchange?.rate.toFixed(2)).toBe('13.00');
      expect(exchange?.fx_gain_loss_kgs).toBeNull();
    });

    it('creates the FIFO layer at the rate actually paid', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');

      const id = await buy('130000.00', '10000.00');

      const layer = await prisma.currency_layers.findFirst({
        where: { cex_document_id: id },
      });
      expect(layer?.rate_kgs.toFixed(2)).toBe('13.00');
      expect(layer?.remaining_amount.toFixed(2)).toBe('10000.00');
    });

    it('records the KGS value on the incoming currency movement', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');

      const id = await buy('130000.00', '10000.00');

      const incoming = await prisma.account_movements.findFirst({
        where: { document_id: id, account_id: ctx.cnyAccount },
      });
      expect(incoming?.kgs_value?.toFixed(2)).toBe('130000.00');
    });

    it('refuses when the KGS account cannot cover it', async () => {
      await contributeCapital(ctx.kgsAccount, '100000.00');

      const { body } = await draftExchange({
        from_account: ctx.kgsAccount,
        to_account: ctx.cnyAccount,
        given_amount: '130000.00',
        received_amount: '10000.00',
      }).expect(201);

      await confirm(body.id).expect(409);
      expect(await balance(ctx.cnyAccount)).toBe('0.00');
      expect(await prisma.currency_layers.count()).toBe(0);
    });

    it('records the commission without moving it separately', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');

      const { body } = await draftExchange({
        from_account: ctx.kgsAccount,
        to_account: ctx.cnyAccount,
        given_amount: '130000.00',
        received_amount: '10000.00',
        commission: '500.00',
        intermediary: 'Dordoi exchange booth',
      }).expect(201);
      await confirm(body.id).expect(201);

      const exchange = await prisma.currency_exchanges.findUnique({
        where: { document_id: body.id },
      });
      expect(exchange?.commission.toFixed(2)).toBe('500.00');
      expect(exchange?.intermediary).toBe('Dordoi exchange booth');
      // Two movements only: what left and what arrived.
      expect(
        await prisma.account_movements.count({ where: { document_id: body.id } }),
      ).toBe(2);
      expect(await balance(ctx.kgsAccount)).toBe('70000.00');
    });
  });

  describe('selling currency back to KGS — FX gain and loss (criterion 4)', () => {
    /** 10 000 CNY bought at 13.00; cost basis 130 000.00 KGS. */
    async function holdingAt13(): Promise<void> {
      await contributeCapital(ctx.kgsAccount, '200000.00');
      await buy('130000.00', '10000.00');
    }

    async function sell(
      givenCny: string,
      receivedKgs: string,
    ): Promise<string> {
      const { body } = await draftExchange({
        from_account: ctx.cnyAccount,
        to_account: ctx.kgsAccount,
        given_amount: givenCny,
        received_amount: receivedKgs,
      }).expect(201);
      await confirm(body.id).expect(201);
      return body.id as string;
    }

    it('books a gain when the currency sells above its cost', async () => {
      await holdingAt13();

      const id = await sell('10000.00', '140000.00');

      const exchange = await prisma.currency_exchanges.findUnique({
        where: { document_id: id },
      });
      // 140 000 received − 130 000 cost basis
      expect(exchange?.fx_gain_loss_kgs?.toFixed(2)).toBe('10000.00');
      expect(exchange?.rate.toFixed(2)).toBe('14.00');
    });

    it('books a loss when the currency sells below its cost', async () => {
      await holdingAt13();

      const id = await sell('10000.00', '120000.00');

      const exchange = await prisma.currency_exchanges.findUnique({
        where: { document_id: id },
      });
      // 120 000 received − 130 000 cost basis
      expect(exchange?.fx_gain_loss_kgs?.toFixed(2)).toBe('-10000.00');
      expect(exchange?.rate.toFixed(2)).toBe('12.00');
    });

    it('books zero when it sells at exactly its cost', async () => {
      await holdingAt13();

      const id = await sell('10000.00', '130000.00');

      const exchange = await prisma.currency_exchanges.findUnique({
        where: { document_id: id },
      });
      expect(exchange?.fx_gain_loss_kgs?.toFixed(2)).toBe('0.00');
    });

    it('costs a partial sale from the oldest layers', async () => {
      await contributeCapital(ctx.kgsAccount, '300000.00');
      await buy('130000.00', '10000.00'); // 13.00
      await buy('67000.00', '5000.00'); // 13.40

      // 12 000 CNY costs 156 800.00 (§10-А.3); sold for 160 000.
      const id = await sell('12000.00', '160000.00');

      const exchange = await prisma.currency_exchanges.findUnique({
        where: { document_id: id },
      });
      expect(exchange?.fx_gain_loss_kgs?.toFixed(2)).toBe('3200.00');
      expect(await balance(ctx.cnyAccount)).toBe('3000.00');
    });

    it('moves both balances and records the cost basis on the outgoing movement', async () => {
      await holdingAt13();

      const id = await sell('10000.00', '140000.00');

      expect(await balance(ctx.cnyAccount)).toBe('0.00');
      expect(await balance(ctx.kgsAccount)).toBe('210000.00'); // 70 000 + 140 000

      const outgoing = await prisma.account_movements.findFirst({
        where: { document_id: id, account_id: ctx.cnyAccount },
      });
      expect(outgoing?.kgs_value?.toFixed(2)).toBe('-130000.00');
    });

    it('empties the consumed layers', async () => {
      await holdingAt13();

      await sell('10000.00', '140000.00');

      const layers = await prisma.currency_layers.findMany();
      expect(layers).toHaveLength(1);
      expect(layers[0].remaining_amount.toFixed(2)).toBe('0.00');
    });
  });

  describe('a currency till can never go negative (criterion 2)', () => {
    it('refuses a sale larger than the holding', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');
      await buy('130000.00', '10000.00');

      const { body } = await draftExchange({
        from_account: ctx.cnyAccount,
        to_account: ctx.kgsAccount,
        given_amount: '10000.01',
        received_amount: '140000.00',
      }).expect(201);

      const res = await confirm(body.id).expect(409);
      expect(res.body.message).toMatch(/not enough|CEX/i);
      expect(await balance(ctx.cnyAccount)).toBe('10000.00');
    });

    it('refuses any sale from an empty till', async () => {
      const { body } = await draftExchange({
        from_account: ctx.cnyAccount,
        to_account: ctx.kgsAccount,
        given_amount: '100.00',
        received_amount: '1300.00',
      }).expect(201);

      await confirm(body.id).expect(409);
      expect(await balance(ctx.cnyAccount)).toBe('0.00');
    });

    it('leaves no movement behind when it refuses', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');
      await buy('130000.00', '10000.00');

      const { body } = await draftExchange({
        from_account: ctx.cnyAccount,
        to_account: ctx.kgsAccount,
        given_amount: '20000.00',
        received_amount: '260000.00',
      }).expect(201);
      await confirm(body.id).expect(409);

      expect(
        await prisma.account_movements.count({ where: { document_id: body.id } }),
      ).toBe(0);
      expect(
        await prisma.currency_layer_consumptions.count({
          where: { document_id: body.id },
        }),
      ).toBe(0);
      const stored = await prisma.documents.findUnique({ where: { id: body.id } });
      expect(stored?.status).toBe(doc_status.DRAFT);
    });

    it('never drives the balance below zero under concurrent sales', async () => {
      await contributeCapital(ctx.kgsAccount, '200000.00');
      await buy('130000.00', '10000.00');

      const drafts = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const { body } = await draftExchange({
            from_account: ctx.cnyAccount,
            to_account: ctx.kgsAccount,
            given_amount: '4000.00',
            received_amount: '52000.00',
          }).expect(201);
          return body.id as string;
        }),
      );

      const results = await Promise.allSettled(
        drafts.map((id) => confirm(id).expect(201)),
      );

      // 10 000 CNY covers exactly two sales of 4 000.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(await balance(ctx.cnyAccount)).toBe('2000.00');
    });
  });

  describe('validation', () => {
    it('refuses an exchange with no KGS side', async () => {
      const res = await draftExchange({
        from_account: ctx.cnyAccount,
        to_account: ctx.usdAccount,
        given_amount: '1000.00',
        received_amount: '140.00',
      }).expect(400);

      expect(res.body.message).toContain('KGS side');
    });

    it('refuses an exchange between two KGS accounts and points at TRN', async () => {
      const otherKgs = await prisma.payment_accounts.create({
        data: { name: 'Second KGS', type: 'CASH', currency: 'KGS' },
        select: { id: true },
      });

      const res = await draftExchange({
        from_account: ctx.kgsAccount,
        to_account: otherKgs.id,
        given_amount: '1000.00',
        received_amount: '1000.00',
      }).expect(400);

      expect(res.body.message).toContain('TRN');
    });

    it.each([
      ['zero given', { given_amount: '0.00' }],
      ['zero received', { received_amount: '0.00' }],
      ['negative commission', { commission: '-1.00' }],
    ])('refuses %s', async (_label, override) => {
      await draftExchange({
        from_account: ctx.kgsAccount,
        to_account: ctx.cnyAccount,
        given_amount: '130000.00',
        received_amount: '10000.00',
        ...override,
      }).expect(400);
    });

    it('refuses a JSON number as an amount', async () => {
      await draftExchange({
        from_account: ctx.kgsAccount,
        to_account: ctx.cnyAccount,
        given_amount: 130000,
        received_amount: '10000.00',
      }).expect(400);
    });

    it('refuses a SALES_MANAGER (§2)', async () => {
      await asStaff(http().post('/api/currency-exchanges'))
        .send({
          from_account: ctx.kgsAccount,
          to_account: ctx.cnyAccount,
          given_amount: '130000.00',
          received_amount: '10000.00',
          business_date: BUSINESS_DATE,
        })
        .expect(403);
    });
  });
});
