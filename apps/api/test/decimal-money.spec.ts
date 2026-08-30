import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { BUSINESS_DATE, Module1Context, resetModule1 } from './module1-harness';

/**
 * Module 1 acceptance criterion 5: every amount is a Decimal, and binary
 * floating point appears nowhere near money.
 *
 * Checked three ways — the source itself, the API boundary, and arithmetic
 * that a float would visibly get wrong.
 */
const SRC = path.join(__dirname, '..', 'src');

/** Words that mark a value as monetary or rate-bearing. */
const MONEY_WORDS = 'amount|price|cost|rate|salary|balance|commission|kgs_value';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // A comment naming the hazard is not the hazard.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) {
        return;
      }
      if (pattern.test(line)) {
        hits.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

describe('Money is Decimal, never float (Module 1, criterion 5)', () => {
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
  const confirm = (id: string) =>
    asOwner(http().post(`/api/documents/${id}/confirm`));

  describe('the source carries no float arithmetic on money', () => {
    it('never calls parseFloat', () => {
      expect(offenders(/\bparseFloat\s*\(/)).toEqual([]);
    });

    it('never calls Number() on a monetary identifier', () => {
      expect(
        offenders(new RegExp(`\\bNumber\\s*\\(\\s*\\w*(${MONEY_WORDS})\\w*\\s*\\)`, 'i')),
      ).toEqual([]);
    });

    it('never types a monetary property as number', () => {
      expect(
        offenders(new RegExp(`\\w*(${MONEY_WORDS})\\w*\\s*[?!]?\\s*:\\s*number\\b`, 'i')),
      ).toEqual([]);
    });

    it('never uses toFixed as a rounding step feeding arithmetic', () => {
      // toFixed for display is fine; toFixed re-parsed into a number is not.
      expect(offenders(/Number\s*\(\s*\w+\.toFixed\s*\(/)).toEqual([]);
    });
  });

  describe('the API refuses JSON numbers for money', () => {
    it.each([
      [
        'capital amount',
        () =>
          asOwner(http().post('/api/capital')).send({
            source: 'OWNER',
            account_id: ctx.kgsAccount,
            amount: 500000.5,
            business_date: BUSINESS_DATE,
          }),
      ],
      [
        'capital rate',
        () =>
          asOwner(http().post('/api/capital')).send({
            source: 'OWNER',
            account_id: ctx.cnyAccount,
            amount: '10000.00',
            rate: 13.0,
            business_date: BUSINESS_DATE,
          }),
      ],
      [
        'withdrawal amount',
        () =>
          asOwner(http().post('/api/withdrawals')).send({
            wtype: 'OWNER_WITHDRAWAL',
            account_id: ctx.kgsAccount,
            amount: 80000.25,
            purpose: 'draw',
            business_date: BUSINESS_DATE,
          }),
      ],
      [
        'exchange given_amount',
        () =>
          asOwner(http().post('/api/currency-exchanges')).send({
            from_account: ctx.kgsAccount,
            to_account: ctx.cnyAccount,
            given_amount: 130000,
            received_amount: '10000.00',
            business_date: BUSINESS_DATE,
          }),
      ],
      [
        'transfer amount',
        () =>
          asOwner(http().post('/api/transfers')).send({
            from_account: ctx.kgsAccount,
            to_account: ctx.kgsAccount,
            amount: 100.1,
            business_date: BUSINESS_DATE,
          }),
      ],
    ])('rejects a float for %s', async (_label, call) => {
      await call().expect(400);
    });
  });

  describe('amounts survive the round trip exactly', () => {
    async function contribute(amount: string, accountId = ctx.kgsAccount): Promise<void> {
      const { body } = await asOwner(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: accountId,
          amount,
          business_date: BUSINESS_DATE,
        })
        .expect(201);
      await confirm(body.id).expect(201);
    }

    const balance = async (): Promise<string> => {
      const { body } = await asOwner(
        http().get(`/api/accounts/${ctx.kgsAccount}/balance`),
      ).expect(200);
      return body.balance as string;
    };

    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    it('adds 0.10 and 0.20 to exactly 0.30', async () => {
      await contribute('0.10');
      await contribute('0.20');

      expect(await balance()).toBe('0.30');
    });

    it('keeps the full NUMERIC(14,2) range', async () => {
      await contribute('999999999999.99');

      expect(await balance()).toBe('999999999999.99');
    });

    it('accumulates a hundred awkward cents without drift', async () => {
      for (let i = 0; i < 10; i += 1) {
        await contribute('0.07');
      }

      expect(await balance()).toBe('0.70');
    });

    it('holds a rate to six decimal places', async () => {
      const { body } = await asOwner(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: ctx.cnyAccount,
          amount: '1000.00',
          rate: '13.123456',
          business_date: BUSINESS_DATE,
        })
        .expect(201);
      await confirm(body.id).expect(201);

      const layer = await prisma.currency_layers.findFirst({
        where: { account_id: ctx.cnyAccount },
      });
      expect(layer?.rate_kgs.toString()).toBe('13.123456');

      // 1000 x 13.123456 = 13 123.456 -> 13 123.46 at money scale.
      const movement = await prisma.account_movements.findFirst({
        where: { document_id: body.id },
      });
      expect(movement?.kgs_value?.toFixed(2)).toBe('13123.46');
    });
  });

  describe('Prisma returns Decimal, not number', () => {
    it('reads monetary columns as Decimal instances', async () => {
      const { body } = await asOwner(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: ctx.kgsAccount,
          amount: '1234.56',
          business_date: BUSINESS_DATE,
        })
        .expect(201);
      await confirm(body.id).expect(201);

      const capital = await prisma.capital_docs.findUnique({
        where: { document_id: body.id },
      });
      const movement = await prisma.account_movements.findFirst({
        where: { document_id: body.id },
      });

      expect(capital?.amount).toBeInstanceOf(Prisma.Decimal);
      expect(movement?.amount).toBeInstanceOf(Prisma.Decimal);
      expect(typeof capital?.amount).not.toBe('number');
    });

    it('serialises money as a string over HTTP', async () => {
      const res = await asOwner(http().get('/api/accounts/balances')).expect(200);

      for (const account of res.body) {
        expect(typeof account.balance).toBe('string');
      }
    });
  });
});
