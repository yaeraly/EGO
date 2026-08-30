import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, resetDatabase } from './app-harness';
import { seedUser } from './fixtures';

/**
 * Module 0 acceptance criterion 4: a plaintext PIN exists nowhere — not in the
 * database, not in the logs.
 *
 * The needles are 8 digits and 20+ characters respectively. An 8-digit run has
 * a ~6e-9 chance of appearing inside any one UUID, so a hit means a real leak,
 * not a coincidence.
 */
const OWNER_PASSWORD = 'Zx9-Quetzal-Marmalade-77';
const OWNER_PIN = '96385274';
const STAFF_PASSWORD = 'Vt4-Basilisk-Tangerine-31';
const STAFF_PIN = '71429630';
const ROTATED_PIN = '58207431';

interface TextColumn {
  table_name: string;
  column_name: string;
}

describe('Credential leakage (Module 0 criterion 4)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let captured: string[];
  let restoreStreams: () => void;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    captured = [];
    restoreStreams = captureProcessOutput(captured);
  });

  afterEach(() => {
    restoreStreams();
  });

  /** Every write to stdout/stderr while the credential flow runs. */
  function captureProcessOutput(sink: string[]): () => void {
    const streams = [process.stdout, process.stderr] as const;
    const originals = streams.map((s) => s.write.bind(s));

    streams.forEach((stream) => {
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        sink.push(String(chunk));
        return (originals[streams.indexOf(stream)] as (...a: unknown[]) => boolean)(
          chunk,
          ...rest,
        );
      }) as typeof stream.write;
    });

    return () => streams.forEach((s, i) => (s.write = originals[i] as typeof s.write));
  }

  /** Every text-ish column in the schema, so no table is quietly skipped. */
  async function textColumns(): Promise<TextColumn[]> {
    return prisma.$queryRawUnsafe<TextColumn[]>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
      ORDER BY table_name, column_name
    `);
  }

  async function findInDatabase(needle: string): Promise<string[]> {
    const hits: string[] = [];
    for (const { table_name, column_name } of await textColumns()) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        `%${needle}%`,
      );
      if (n > 0) {
        hits.push(`${table_name}.${column_name} (${n} row(s))`);
      }
    }
    return hits;
  }

  function findInLogs(needle: string): string[] {
    return captured.filter((line) => line.includes(needle));
  }

  /**
   * Drives every path that handles a PIN or password: user creation, login,
   * PIN verify (both outcomes), self-service change, and OWNER reset.
   */
  async function exerciseCredentialFlows(): Promise<void> {
    const owner = await seedUser(prisma, {
      phone: '0700000001',
      password: OWNER_PASSWORD,
      pin: OWNER_PIN,
      role: 'OWNER',
      full_name: 'Owner',
    });

    const http = () => request(app.getHttpServer());

    const { body: ownerLogin } = await http()
      .post('/api/auth/login')
      .send({ phone: owner.phone, password: OWNER_PASSWORD })
      .expect(200);
    const ownerToken = ownerLogin.access_token as string;

    // Creation through the API — the plaintext arrives in a request body and
    // must not survive anywhere past hashing.
    const { body: created } = await http()
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        full_name: 'Sales Manager',
        phone: '0700000002',
        role: 'SALES_MANAGER',
        password: STAFF_PASSWORD,
        pin: STAFF_PIN,
      })
      .expect(201);

    const { body: staffLogin } = await http()
      .post('/api/auth/login')
      .send({ phone: '0700000002', password: STAFF_PASSWORD })
      .expect(200);
    const staffToken = staffLogin.access_token as string;

    await http()
      .post('/api/auth/pin/verify')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ pin: STAFF_PIN })
      .expect(200);

    await http()
      .post('/api/auth/pin/verify')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ pin: '11111111' })
      .expect(200);

    await http()
      .patch('/api/auth/pin')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ current_pin: STAFF_PIN, new_pin: ROTATED_PIN })
      .expect(204);

    // A failed login, so the LOGIN_FAIL path is covered too.
    await http()
      .post('/api/auth/login')
      .send({ phone: '0700000002', password: 'Wrong-Password-000' })
      .expect(401);

    await http()
      .patch(`/api/users/${created.id}/pin`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ new_pin: '30498271' })
      .expect(204);
  }

  it.each([
    ['owner PIN', OWNER_PIN],
    ['staff PIN', STAFF_PIN],
    ['rotated PIN', ROTATED_PIN],
    ['owner password', OWNER_PASSWORD],
    ['staff password', STAFF_PASSWORD],
  ])('leaves no %s in any database column', async (_label, needle) => {
    await exerciseCredentialFlows();

    expect(await findInDatabase(needle)).toEqual([]);
  });

  it.each([
    ['staff PIN', STAFF_PIN],
    ['staff password', STAFF_PASSWORD],
  ])('leaves no %s in stdout or stderr', async (_label, needle) => {
    await exerciseCredentialFlows();

    expect(findInLogs(needle)).toEqual([]);
  });

  it('stores argon2id digests, not the credentials themselves', async () => {
    await exerciseCredentialFlows();

    const users = await prisma.users.findMany({
      select: { pin_hash: true, password_hash: true },
    });

    expect(users).toHaveLength(2);
    for (const user of users) {
      expect(user.pin_hash).toMatch(/^\$argon2id\$/);
      expect(user.password_hash).toMatch(/^\$argon2id\$/);
    }
  });

  it('records PIN outcomes without recording the PIN', async () => {
    await exerciseCredentialFlows();

    const log = await prisma.security_log.findMany({
      orderBy: { id: 'asc' },
      select: { event: true, user_id: true },
    });

    expect(log.map((e) => e.event)).toEqual([
      'LOGIN_OK',
      'LOGIN_OK',
      'PIN_OK',
      'PIN_FAIL',
      'PIN_OK',
      'LOGIN_FAIL',
    ]);
    expect(log.every((e) => e.user_id !== null)).toBe(true);
  });
});
