import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { BUSINESS_DATE, Module1Context, resetModule1 } from './module1-harness';

/**
 * CLAUDE.md, Security: "Бардык mutating endpoint'тер idempotency key кабыл
 * алат" (Connectivity: duplicate protection).
 */
describe('Idempotency keys', () => {
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

  const capitalBody = (amount = '100000.00') => ({
    source: 'OWNER',
    account_id: ctx.kgsAccount,
    amount,
    business_date: BUSINESS_DATE,
  });

  const postCapital = (key: string | null, body = capitalBody()) => {
    const req = asOwner(http().post('/api/capital'));
    if (key) {
      req.set('Idempotency-Key', key);
    }
    return req.send(body);
  };

  it('runs normally with no key', async () => {
    await postCapital(null).expect(201);
    await postCapital(null).expect(201);

    expect(await prisma.capital_docs.count()).toBe(2);
  });

  it('runs once and replays the same response for a repeated key', async () => {
    const first = await postCapital('key-alpha').expect(201);
    const second = await postCapital('key-alpha').expect(201);

    expect(second.body).toEqual(first.body);
    expect(await prisma.capital_docs.count()).toBe(1);
    expect(await prisma.documents.count()).toBe(1);
  });

  it('spends no document number on the replay', async () => {
    const first = await postCapital('key-alpha').expect(201);
    await postCapital('key-alpha').expect(201);

    expect(first.body.doc_number).toMatch(/-000001$/);
    const next = await postCapital('key-beta').expect(201);
    expect(next.body.doc_number).toMatch(/-000002$/);
  });

  it('refuses the same key with a different body', async () => {
    await postCapital('key-alpha', capitalBody('100000.00')).expect(201);

    const res = await postCapital('key-alpha', capitalBody('999.00')).expect(409);

    expect(res.body.message).toContain('different request');
    expect(await prisma.capital_docs.count()).toBe(1);
  });

  it('scopes keys per user', async () => {
    await postCapital('shared-key').expect(201);

    // The same key from another user is a different key.
    await asStaff(http().post('/api/auth/pin/verify'))
      .set('Idempotency-Key', 'shared-key')
      .send({ pin: '87654321' })
      .expect(200);

    const rows = await prisma.idempotency_keys.findMany({
      where: { key: 'shared-key' },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(2);
  });

  it('lets a failed request be retried', async () => {
    // No funds, so confirming fails.
    const { body: draft } = await postCapital(null).expect(201);
    const { body: withdrawal } = await asOwner(http().post('/api/withdrawals'))
      .send({
        wtype: 'OWNER_WITHDRAWAL',
        account_id: ctx.kgsAccount,
        amount: '999999.00',
        purpose: 'too much',
        business_date: BUSINESS_DATE,
      })
      .expect(201);
    expect(draft.id).toBeDefined();

    await asOwner(http().post(`/api/documents/${withdrawal.id}/confirm`))
      .set('Idempotency-Key', 'confirm-key')
      .expect(409);

    // The claim was released, so the key is free for a real retry.
    expect(
      await prisma.idempotency_keys.count({ where: { key: 'confirm-key' } }),
    ).toBe(0);

    await asOwner(http().post(`/api/documents/${draft.id}/confirm`)).expect(201);
    await asOwner(http().post(`/api/documents/${withdrawal.id}/confirm`))
      .set('Idempotency-Key', 'confirm-key')
      .expect(409); // still more than the balance, but it genuinely ran again
  });

  it('deduplicates a confirm, which is where a lost response hurts most', async () => {
    const { body: capital } = await postCapital(null).expect(201);

    const first = await asOwner(
      http().post(`/api/documents/${capital.id}/confirm`),
    )
      .set('Idempotency-Key', 'confirm-once')
      .expect(201);
    const second = await asOwner(
      http().post(`/api/documents/${capital.id}/confirm`),
    )
      .set('Idempotency-Key', 'confirm-once')
      .expect(201);

    expect(second.body).toEqual(first.body);
    // Without the key the second confirm would have been a 409; with it the
    // client sees the original success and the money moved exactly once.
    expect(await prisma.account_movements.count()).toBe(1);
  });

  it('holds under a concurrent double-submit', async () => {
    const results = await Promise.allSettled([
      postCapital('race-key'),
      postCapital('race-key'),
    ]);

    const statuses = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<request.Response>).value.status);

    // One runs; the other either replays it (201) or is told it is in flight
    // (409). Either way the work happens once.
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.capital_docs.count()).toBe(1);
  });

  it('records the endpoint and a body hash', async () => {
    await postCapital('key-alpha').expect(201);

    const row = await prisma.idempotency_keys.findFirst({
      where: { key: 'key-alpha' },
    });
    expect(row?.endpoint).toContain('POST');
    expect(row?.endpoint).toContain('capital');
    expect(row?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.status_code).toBe(201);
    expect(row?.completed_at).not.toBeNull();
  });

  it('rejects an unusable key', async () => {
    await postCapital('x'.repeat(201)).expect(409);
  });

  it('ignores the header on a read', async () => {
    const first = await asOwner(http().get('/api/accounts'))
      .set('Idempotency-Key', 'read-key')
      .expect(200);
    const second = await asOwner(http().get('/api/accounts'))
      .set('Idempotency-Key', 'read-key')
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(await prisma.idempotency_keys.count()).toBe(0);
  });
});
