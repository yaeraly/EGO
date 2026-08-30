import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  currentBusinessDate,
  parseBusinessDate,
  resolveBusinessDate,
} from '../src/documents/business-date';
import { createTestApp } from './app-harness';
import { Module1Context, resetModule1 } from './module1-harness';

/**
 * CLAUDE.md rule 5: the server stores UTC, the business logic works in
 * Asia/Bishkek. Period Lock: "Business Date демейки боюнча = документ түзүлгөн
 * календардык күн".
 */
describe('Business date (Period Lock, Asia/Bishkek)', () => {
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

  describe('currentBusinessDate resolves the Bishkek day', () => {
    it.each([
      // Bishkek is UTC+6 year round.
      ['2026-03-15T06:00:00.000Z', '2026-03-15'],
      // 19:00 UTC is already 01:00 the next day in Bishkek.
      ['2026-03-15T19:00:00.000Z', '2026-03-16'],
      // 17:59 UTC is still 23:59 the same day.
      ['2026-03-15T17:59:00.000Z', '2026-03-15'],
      // Midnight UTC is 06:00 in Bishkek — same date.
      ['2026-03-15T00:00:00.000Z', '2026-03-15'],
      // Across a year boundary.
      ['2025-12-31T18:30:00.000Z', '2026-01-01'],
    ])('%s -> %s', (iso, expected) => {
      expect(currentBusinessDate(new Date(iso)).toISOString().slice(0, 10)).toBe(
        expected,
      );
    });
  });

  describe('resolveBusinessDate', () => {
    it('uses the supplied date when there is one', () => {
      expect(resolveBusinessDate('2026-01-20')).toEqual(
        parseBusinessDate('2026-01-20'),
      );
    });

    it.each([[undefined], [null], ['']])(
      'falls back to today in Bishkek for %p',
      (value) => {
        expect(resolveBusinessDate(value as string | undefined)).toEqual(
          currentBusinessDate(),
        );
      },
    );
  });

  describe('the API defaults business_date', () => {
    const today = (): string =>
      currentBusinessDate().toISOString().slice(0, 10);

    it('books a document to today when the field is omitted', async () => {
      const { body } = await asOwner(http().post('/api/capital'))
        .send({ source: 'OWNER', account_id: ctx.kgsAccount, amount: '1000.00' })
        .expect(201);

      expect(body.business_date.slice(0, 10)).toBe(today());
    });

    it('opens today as the business day', async () => {
      await asOwner(http().post('/api/capital'))
        .send({ source: 'OWNER', account_id: ctx.kgsAccount, amount: '1000.00' })
        .expect(201);

      const day = await prisma.business_days.findFirst();
      expect(day?.business_date.toISOString().slice(0, 10)).toBe(today());
      expect(day?.status).toBe('OPEN');
    });

    it('still honours an explicit backdate within an open period', async () => {
      const { body } = await asOwner(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: ctx.kgsAccount,
          amount: '1000.00',
          business_date: '2026-01-05',
        })
        .expect(201);

      expect(body.business_date.slice(0, 10)).toBe('2026-01-05');
    });

    it('still rejects a malformed date', async () => {
      await asOwner(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: ctx.kgsAccount,
          amount: '1000.00',
          business_date: '05.01.2026',
        })
        .expect(400);
    });

    it('stores the business date as a plain day, free of timezone drift', async () => {
      const { body } = await asOwner(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: ctx.kgsAccount,
          amount: '1000.00',
          business_date: '2026-01-05',
        })
        .expect(201);

      const document = await prisma.documents.findUnique({
        where: { id: body.id },
      });
      expect(document?.business_date.toISOString()).toBe(
        '2026-01-05T00:00:00.000Z',
      );
    });
  });
});
