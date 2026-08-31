import { INestApplication } from '@nestjs/common';
import { PrismaClient, doc_status } from '@prisma/client';
import request from 'supertest';
import { createTestApp, resetDatabase } from './app-harness';
import { seedUser } from './fixtures';

const PASSWORD = 'status-machine-password';

describe('Document status machine (Module 0.3, criterion 2)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedUser(prisma, {
      phone: '0700000001',
      password: PASSWORD,
      pin: '12345678',
      role: 'OWNER',
    });
    const { body } = await http()
      .post('/api/auth/login')
      .send({ phone: '0700000001', password: PASSWORD })
      .expect(200);
    token = body.access_token as string;
  });

  /**
   * A bare document of a type that has no posting logic yet.
   *
   * These tests are about the status machine itself, so the type must be one
   * confirming does nothing else for: a SAL, say, now runs the sale poster and
   * would rightly refuse a header with no sale behind it. LOT is such a type —
   * a receipt raises it as part of its own posting (§18.1), so it has no
   * poster of its own. (COR served this purpose until §27.1 gave it one.)
   */
  async function newDraft(): Promise<{ id: string; doc_number: string }> {
    const { body } = await auth(http().post('/api/documents'))
      .send({ doc_type: 'LOT', business_date: '2026-03-15' })
      .expect(201);
    expect(body.status).toBe(doc_status.DRAFT);
    return body;
  }

  async function auditActions(): Promise<string[]> {
    const rows = await prisma.audit_log.findMany({
      orderBy: { id: 'asc' },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  }

  describe('allowed transitions', () => {
    it('confirms a draft', async () => {
      const draft = await newDraft();

      const res = await auth(
        http().post(`/api/documents/${draft.id}/confirm`),
      ).expect(201);

      expect(res.body.status).toBe(doc_status.CONFIRMED);
      expect(res.body.confirmed_at).not.toBeNull();
      expect(res.body.confirmed_by).not.toBeNull();
      expect(await auditActions()).toEqual([
        'DOCUMENT_CREATED',
        'DOCUMENT_CONFIRMED',
      ]);
    });

    it('cancels a draft', async () => {
      const draft = await newDraft();

      const res = await auth(http().post(`/api/documents/${draft.id}/cancel`))
        .send({ reason: 'entered by mistake' })
        .expect(201);

      expect(res.body.status).toBe(doc_status.CANCELLED);
      expect(res.body.cancelled_at).not.toBeNull();

      const [, cancelled] = await prisma.audit_log.findMany({
        orderBy: { id: 'asc' },
      });
      expect(cancelled.action).toBe('DOCUMENT_CANCELLED');
      expect(cancelled.reason).toBe('entered by mistake');
    });

    it('edits a draft', async () => {
      const draft = await newDraft();

      const res = await auth(http().patch(`/api/documents/${draft.id}`))
        .send({ comment: 'revised note' })
        .expect(200);

      expect(res.body.comment).toBe('revised note');
      expect(await auditActions()).toEqual([
        'DOCUMENT_CREATED',
        'DOCUMENT_UPDATED',
      ]);
    });
  });

  describe('a CONFIRMED document can no longer be changed', () => {
    async function confirmed(): Promise<{ id: string; doc_number: string }> {
      const draft = await newDraft();
      await auth(http().post(`/api/documents/${draft.id}/confirm`)).expect(201);
      return draft;
    }

    it('rejects an update with 409 and records it in the audit log', async () => {
      const doc = await confirmed();

      const res = await auth(http().patch(`/api/documents/${doc.id}`))
        .send({ comment: 'sneaky edit' })
        .expect(409);

      expect(res.body.message).toContain(doc.doc_number);
      expect(res.body.message).toContain('CONFIRMED');

      const rejected = await prisma.audit_log.findFirst({
        where: { action: 'DOCUMENT_UPDATE_REJECTED' },
      });
      expect(rejected).not.toBeNull();
      expect(rejected?.document_id).toBe(doc.id);
      expect(rejected?.old_value).toEqual({ status: 'CONFIRMED' });
      expect(rejected?.reason).toContain('UPDATE_COMMENT');

      const stored = await prisma.documents.findUnique({ where: { id: doc.id } });
      expect(stored?.comment).toBeNull();
    });

    // CANCELLED is reachable from DRAFT only: a confirmed document has already
    // posted, so reversing it is a COR document, not a status flip.
    it('refuses to cancel a confirmed document', async () => {
      const doc = await confirmed();

      await auth(http().post(`/api/documents/${doc.id}/cancel`))
        .send({ reason: 'changed my mind' })
        .expect(409);

      const stored = await prisma.documents.findUnique({ where: { id: doc.id } });
      expect(stored?.status).toBe(doc_status.CONFIRMED);
      expect(stored?.cancelled_at).toBeNull();
    });

    it('refuses a second confirmation', async () => {
      const doc = await confirmed();

      await auth(http().post(`/api/documents/${doc.id}/confirm`)).expect(409);

      expect(
        await prisma.audit_log.count({ where: { action: 'DOCUMENT_CONFIRMED' } }),
      ).toBe(1);
    });
  });

  describe('a CANCELLED document is final', () => {
    async function cancelled(): Promise<{ id: string }> {
      const draft = await newDraft();
      await auth(http().post(`/api/documents/${draft.id}/cancel`))
        .send({})
        .expect(201);
      return draft;
    }

    it.each([
      ['confirm', (id: string) => http().post(`/api/documents/${id}/confirm`)],
      ['cancel', (id: string) => http().post(`/api/documents/${id}/cancel`)],
    ])('refuses to %s it', async (_label, call) => {
      const doc = await cancelled();

      await auth(call(doc.id)).send({}).expect(409);
    });

    it('refuses an edit', async () => {
      const doc = await cancelled();

      await auth(http().patch(`/api/documents/${doc.id}`))
        .send({ comment: 'too late' })
        .expect(409);
    });
  });

  describe('audit log is append-only from the application', () => {
    it('offers no way to amend a recorded entry', async () => {
      const draft = await newDraft();
      await auth(http().post(`/api/documents/${draft.id}/confirm`)).expect(201);

      const before = await prisma.audit_log.findMany({ orderBy: { id: 'asc' } });

      await auth(http().patch(`/api/documents/${draft.id}`))
        .send({ comment: 'rejected' })
        .expect(409);

      const after = await prisma.audit_log.findMany({ orderBy: { id: 'asc' } });

      // The earlier entries are untouched; the refusal only appended.
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
    });
  });

  describe('validation', () => {
    it('rejects an unknown document type', async () => {
      await auth(http().post('/api/documents'))
        .send({ doc_type: 'XXX', business_date: '2026-03-15' })
        .expect(400);
    });

    it('rejects a malformed business date', async () => {
      await auth(http().post('/api/documents'))
        .send({ doc_type: 'COR', business_date: '15.03.2026' })
        .expect(400);
    });

    it('404s on an unknown document', async () => {
      await auth(
        http().post('/api/documents/00000000-0000-0000-0000-000000000000/confirm'),
      ).expect(404);
    });

    it('requires authentication', async () => {
      await http().post('/api/documents').send({}).expect(401);
    });
  });
});
