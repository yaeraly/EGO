import { INestApplication } from '@nestjs/common';
import { PrismaClient, day_status, doc_type, month_status } from '@prisma/client';
import request from 'supertest';
import { sequenceYear } from '../src/documents/document-number';
import { DocumentsService } from '../src/documents/documents.service';
import { createTestApp, resetDatabase } from './app-harness';
import { createAccount, seedUser } from './fixtures';

const PASSWORD = 'business-days-password';
const DATE = '2026-03-15';

describe('Business days and the Period Lock (Module 0.6, criterion 5)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let documents: DocumentsService;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    documents = app.get(DocumentsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    await resetDatabase(prisma);
    const owner = await seedUser(prisma, {
      phone: '0700000001',
      password: PASSWORD,
      pin: '12345678',
      role: 'OWNER',
    });
    userId = owner.id;
    const { body } = await http()
      .post('/api/auth/login')
      .send({ phone: '0700000001', password: PASSWORD })
      .expect(200);
    token = body.access_token as string;
  });

  const createDocument = (date = DATE) =>
    auth(http().post('/api/documents')).send({ doc_type: 'SAL', business_date: date });

  const closeDay = (date: string) =>
    prisma.business_days.update({
      where: { business_date: new Date(`${date}T00:00:00.000Z`) },
      data: { status: day_status.DAY_CLOSED, closed_by: userId, closed_at: new Date() },
    });

  describe('a day opens on first use', () => {
    it('creates the day automatically, OPEN', async () => {
      expect(await prisma.business_days.count()).toBe(0);

      await createDocument().expect(201);

      const day = await prisma.business_days.findUnique({
        where: { business_date: new Date(`${DATE}T00:00:00.000Z`) },
      });
      expect(day?.status).toBe(day_status.OPEN);
      expect(day?.closed_at).toBeNull();
    });

    it('opens each date once, however many documents land on it', async () => {
      await createDocument().expect(201);
      await createDocument().expect(201);
      await createDocument('2026-03-16').expect(201);

      expect(await prisma.business_days.count()).toBe(2);
    });

    it('opens the day exactly once under concurrency', async () => {
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          documents.createStandalone({
            docType: doc_type.SAL,
            businessDate: new Date(`${DATE}T00:00:00.000Z`),
            userId,
          }),
        ),
      );

      expect(results).toHaveLength(25);
      expect(await prisma.business_days.count()).toBe(1);
    });

    it('exposes the day through the API', async () => {
      await createDocument().expect(201);

      const res = await auth(http().get(`/api/business-days/${DATE}`)).expect(200);
      expect(res.body.status).toBe(day_status.OPEN);
    });

    it('404s for a date never used', async () => {
      await auth(http().get('/api/business-days/2026-01-01')).expect(404);
    });
  });

  describe('a closed day refuses new documents with 423', () => {
    beforeEach(async () => {
      await createDocument().expect(201);
      await closeDay(DATE);
    });

    it('rejects a document booked to it', async () => {
      const res = await createDocument().expect(423);

      expect(res.body.message).toContain(DATE);
      expect(res.body.message).toContain('COR');
    });

    it('spends no document number on the refusal', async () => {
      const key = { doc_type_year: { doc_type: doc_type.SAL, year: sequenceYear() } };
      const before = await prisma.doc_sequences.findUnique({ where: key });

      await createDocument().expect(423);

      const after = await prisma.doc_sequences.findUnique({ where: key });
      expect(after?.last_number).toBe(before?.last_number);
      expect(await prisma.documents.count()).toBe(1);
    });

    it('still accepts documents on an open day', async () => {
      await createDocument('2026-03-16').expect(201);
    });

    it('blocks every document type, not just sales', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });

      await auth(http().post('/api/transfers'))
        .send({ from_account: from, to_account: to, amount: '10.00', business_date: DATE })
        .expect(423);
    });

    it('leaves documents already on the day untouched', async () => {
      const existing = await prisma.documents.findMany();
      expect(existing).toHaveLength(1);

      await createDocument().expect(423);

      expect(await prisma.documents.findMany()).toEqual(existing);
    });
  });

  describe('CASH_HANDED is not yet a lock', () => {
    it('still accepts documents (Day Close is Priority 2)', async () => {
      await createDocument().expect(201);
      await prisma.business_days.update({
        where: { business_date: new Date(`${DATE}T00:00:00.000Z`) },
        data: { status: day_status.CASH_HANDED },
      });

      await createDocument().expect(201);
    });
  });

  describe('a closed month seals its days', () => {
    it('refuses a document in a closed month with 423', async () => {
      await prisma.business_months.create({
        data: { year: 2026, month: 3, status: month_status.MONTH_CLOSED },
      });

      const res = await createDocument().expect(423);

      expect(res.body.message).toContain('2026-03');
    });

    it('does not open a day it refused', async () => {
      await prisma.business_months.create({
        data: { year: 2026, month: 3, status: month_status.MONTH_CLOSED },
      });

      await createDocument().expect(423);

      expect(await prisma.business_days.count()).toBe(0);
    });

    it('leaves other months alone', async () => {
      await prisma.business_months.create({
        data: { year: 2026, month: 3, status: month_status.MONTH_CLOSED },
      });

      await createDocument('2026-04-01').expect(201);
    });

    it('accepts documents in an explicitly open month', async () => {
      await prisma.business_months.create({
        data: { year: 2026, month: 3, status: month_status.OPEN },
      });

      await createDocument().expect(201);
    });
  });
});
