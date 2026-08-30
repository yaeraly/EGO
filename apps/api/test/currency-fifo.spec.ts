import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { CurrencyFifoService } from '../src/currency/currency-fifo.service';
import { createTestApp } from './app-harness';
import { BUSINESS_DATE, Module1Context, resetModule1 } from './module1-harness';

/**
 * Module 1 acceptance criterion 1 — the §10-А.3 worked example, exactly:
 *
 *   CEX-1: 10 000 CNY x 13.00 = 130 000 KGS
 *   CEX-2:  5 000 CNY x 13.40 =  67 000 KGS
 *   payment out: 12 000 CNY
 *   FIFO: 10 000 x 13.00 + 2 000 x 13.40 = 156 800.00 KGS
 */
describe('Currency FIFO (Module 1.4, criterion 1)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fifo: CurrencyFifoService;
  let ctx: Omit<Module1Context, 'app' | 'prisma'>;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    fifo = app.get(CurrencyFifoService);
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

  const confirm = (id: string) =>
    asOwner(http().post(`/api/documents/${id}/confirm`)).expect(201);

  /** Brings KGS in as capital, the way money actually enters the business. */
  async function contributeCapital(amount: string): Promise<void> {
    const { body } = await asOwner(http().post('/api/capital'))
      .send({
        source: 'OWNER',
        account_id: ctx.kgsAccount,
        amount,
        business_date: BUSINESS_DATE,
      })
      .expect(201);
    await confirm(body.id);
  }

  /** Buys currency: KGS out, currency in, one new layer at the implied rate. */
  async function buyCurrency(
    givenKgs: string,
    receivedCny: string,
  ): Promise<string> {
    const { body } = await asOwner(http().post('/api/currency-exchanges'))
      .send({
        from_account: ctx.kgsAccount,
        to_account: ctx.cnyAccount,
        given_amount: givenKgs,
        received_amount: receivedCny,
        business_date: BUSINESS_DATE,
      })
      .expect(201);
    await confirm(body.id);
    return body.id as string;
  }

  async function knowledgeBaseExample(): Promise<void> {
    await contributeCapital('200000.00');
    await buyCurrency('130000.00', '10000.00');
    await buyCurrency('67000.00', '5000.00');
  }

  describe('the §10-А.3 example', () => {
    it('builds one layer per exchange, at its own rate', async () => {
      await knowledgeBaseExample();

      const layers = await prisma.currency_layers.findMany({
        where: { account_id: ctx.cnyAccount },
        orderBy: { created_at: 'asc' },
      });

      expect(layers).toHaveLength(2);
      expect(layers[0].original_amount.toFixed(2)).toBe('10000.00');
      expect(layers[0].rate_kgs.toFixed(2)).toBe('13.00');
      expect(layers[1].original_amount.toFixed(2)).toBe('5000.00');
      expect(layers[1].rate_kgs.toFixed(2)).toBe('13.40');
    });

    it('costs a 12 000 CNY payment at exactly 156 800.00 KGS', async () => {
      await knowledgeBaseExample();

      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      const result = await prisma.$transaction((tx) =>
        fifo.consumeCurrency(tx, {
          accountId: ctx.cnyAccount,
          amount: new Prisma.Decimal('12000.00'),
          documentId,
        }),
      );

      expect(result.kgsValue.toFixed(2)).toBe('156800.00');
    });

    it('takes 10 000 from the older layer and 2 000 from the newer', async () => {
      await knowledgeBaseExample();
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      const result = await prisma.$transaction((tx) =>
        fifo.consumeCurrency(tx, {
          accountId: ctx.cnyAccount,
          amount: new Prisma.Decimal('12000.00'),
          documentId,
        }),
      );

      expect(
        result.layers.map((l) => ({
          amount: l.amount.toFixed(2),
          rate: l.rate_kgs.toFixed(2),
          kgs: l.kgs_value.toFixed(2),
        })),
      ).toEqual([
        { amount: '10000.00', rate: '13.00', kgs: '130000.00' },
        { amount: '2000.00', rate: '13.40', kgs: '26800.00' },
      ]);
    });

    it('leaves 3 000 CNY in the newer layer', async () => {
      await knowledgeBaseExample();
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      await prisma.$transaction((tx) =>
        fifo.consumeCurrency(tx, {
          accountId: ctx.cnyAccount,
          amount: new Prisma.Decimal('12000.00'),
          documentId,
        }),
      );

      const layers = await prisma.currency_layers.findMany({
        where: { account_id: ctx.cnyAccount },
        orderBy: { created_at: 'asc' },
      });
      expect(layers[0].remaining_amount.toFixed(2)).toBe('0.00');
      expect(layers[1].remaining_amount.toFixed(2)).toBe('3000.00');
    });

    it('records what each layer gave up', async () => {
      await knowledgeBaseExample();
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      await prisma.$transaction((tx) =>
        fifo.consumeCurrency(tx, {
          accountId: ctx.cnyAccount,
          amount: new Prisma.Decimal('12000.00'),
          documentId,
        }),
      );

      const consumptions = await prisma.currency_layer_consumptions.findMany({
        orderBy: { id: 'asc' },
      });
      expect(consumptions).toHaveLength(2);
      expect(
        consumptions
          .reduce((s, c) => s.plus(c.kgs_value), new Prisma.Decimal(0))
          .toFixed(2),
      ).toBe('156800.00');
    });
  });

  describe('FIFO order and sufficiency', () => {
    it('consumes strictly oldest first across three layers', async () => {
      await contributeCapital('500000.00');
      await buyCurrency('10000.00', '1000.00'); // 10.00
      await buyCurrency('22000.00', '2000.00'); // 11.00
      await buyCurrency('36000.00', '3000.00'); // 12.00
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      const result = await prisma.$transaction((tx) =>
        fifo.consumeCurrency(tx, {
          accountId: ctx.cnyAccount,
          amount: new Prisma.Decimal('4500.00'),
          documentId,
        }),
      );

      // 1000x10 + 2000x11 + 1500x12 = 10 000 + 22 000 + 18 000
      expect(result.kgsValue.toFixed(2)).toBe('50000.00');
      expect(result.layers.map((l) => l.rate_kgs.toFixed(2))).toEqual([
        '10.00',
        '11.00',
        '12.00',
      ]);
    });

    it('refuses to consume more than the till holds (§10-А.4)', async () => {
      await knowledgeBaseExample();
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      await expect(
        prisma.$transaction((tx) =>
          fifo.consumeCurrency(tx, {
            accountId: ctx.cnyAccount,
            amount: new Prisma.Decimal('15000.01'),
            documentId,
            accountName: 'CNY Cash',
          }),
        ),
      ).rejects.toThrow(/not enough|CEX/i);
    });

    it('leaves every layer untouched when it cannot be satisfied', async () => {
      await knowledgeBaseExample();
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);
      const before = await prisma.currency_layers.findMany({
        orderBy: { created_at: 'asc' },
      });

      await expect(
        prisma.$transaction((tx) =>
          fifo.consumeCurrency(tx, {
            accountId: ctx.cnyAccount,
            amount: new Prisma.Decimal('20000.00'),
            documentId,
          }),
        ),
      ).rejects.toThrow();

      expect(
        await prisma.currency_layers.findMany({ orderBy: { created_at: 'asc' } }),
      ).toEqual(before);
      expect(await prisma.currency_layer_consumptions.count()).toBe(0);
    });

    it('empties the till exactly', async () => {
      await knowledgeBaseExample();
      const documentId = await anyDocumentId(prisma, ctx.cnyAccount);

      const result = await prisma.$transaction((tx) =>
        fifo.consumeCurrency(tx, {
          accountId: ctx.cnyAccount,
          amount: new Prisma.Decimal('15000.00'),
          documentId,
        }),
      );

      expect(result.kgsValue.toFixed(2)).toBe('197000.00'); // 130 000 + 67 000
      const remaining = await prisma.$transaction((tx) =>
        fifo.remaining(tx, ctx.cnyAccount),
      );
      expect(remaining.toFixed(2)).toBe('0.00');
    });
  });

  describe('layers stay in step with the balance', () => {
    it('matches the account balance after every exchange', async () => {
      await knowledgeBaseExample();

      const remaining = await prisma.$transaction((tx) =>
        fifo.remaining(tx, ctx.cnyAccount),
      );
      const { body } = await asOwner(
        http().get(`/api/accounts/${ctx.cnyAccount}/balance`),
      ).expect(200);

      expect(remaining.toFixed(2)).toBe(body.balance);
      expect(body.balance).toBe('15000.00');
    });
  });
});

/**
 * Any confirmed document id, to hang consumption lines on. The FIFO service
 * takes a document because currency_layer_consumptions.document_id is NOT
 * NULL — every consumption belongs to the document that spent the currency
 * (§27). SPY and CPY will pass their own.
 */
async function anyDocumentId(
  prisma: PrismaClient,
  accountId: string,
): Promise<string> {
  const layer = await prisma.currency_layers.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: 'asc' },
    select: { cex_document_id: true },
  });
  return layer!.cex_document_id;
}
