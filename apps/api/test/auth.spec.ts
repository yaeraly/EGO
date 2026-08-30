import { INestApplication } from '@nestjs/common';
import { PrismaClient, user_role, user_status } from '@prisma/client';
import request from 'supertest';
import { createTestApp, resetDatabase } from './app-harness';
import { seedUser } from './fixtures';

const PASSWORD = 'correct-horse-battery';
const PIN = '4821';

describe('Auth (Module 0.2)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

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
  });

  const http = () => request(app.getHttpServer());

  const login = (phone: string, password: string) =>
    http().post('/api/auth/login').send({ phone, password });

  async function events(): Promise<string[]> {
    const rows = await prisma.security_log.findMany({
      orderBy: { id: 'asc' },
      select: { event: true },
    });
    return rows.map((r) => r.event);
  }

  describe('login', () => {
    it('issues a JWT for a valid phone and password', async () => {
      await seedUser(prisma, { phone: '0700111222', password: PASSWORD, pin: PIN });

      const res = await login('0700111222', PASSWORD).expect(200);

      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.user).toMatchObject({
        phone: '0700111222',
        role: user_role.SALES_MANAGER,
      });
      expect(await events()).toEqual(['LOGIN_OK']);
    });

    it('rejects a wrong password and logs LOGIN_FAIL', async () => {
      await seedUser(prisma, { phone: '0700111222', password: PASSWORD, pin: PIN });

      await login('0700111222', 'wrong-password').expect(401);

      expect(await events()).toEqual(['LOGIN_FAIL']);
    });

    it('rejects an unknown phone and logs LOGIN_FAIL', async () => {
      await login('0700999999', PASSWORD).expect(401);

      expect(await events()).toEqual(['LOGIN_FAIL']);
    });

    // Security: a departing employee is deactivated, not deleted — and must
    // not be able to log in.
    it.each([user_status.INACTIVE, user_status.BLOCKED])(
      'refuses a %s account',
      async (status) => {
        await seedUser(prisma, {
          phone: '0700111222',
          password: PASSWORD,
          pin: PIN,
          status,
        });

        await login('0700111222', PASSWORD).expect(401);

        expect(await events()).toEqual(['LOGIN_FAIL']);
      },
    );

    it('never returns a credential digest', async () => {
      await seedUser(prisma, { phone: '0700111222', password: PASSWORD, pin: PIN });

      const res = await login('0700111222', PASSWORD).expect(200);

      expect(JSON.stringify(res.body)).not.toContain('argon2');
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(res.body.user).not.toHaveProperty('pin_hash');
    });
  });

  describe('logout', () => {
    it('logs LOGOUT for the authenticated user', async () => {
      const user = await seedUser(prisma, {
        phone: '0700111222',
        password: PASSWORD,
        pin: PIN,
      });
      const { body } = await login(user.phone, PASSWORD).expect(200);

      await http()
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${body.access_token}`)
        .expect(204);

      expect(await events()).toEqual(['LOGIN_OK', 'LOGOUT']);
    });

    it('requires a token', async () => {
      await http().post('/api/auth/logout').expect(401);
    });
  });

  describe('PIN verify', () => {
    async function tokenFor(pin: string): Promise<string> {
      await seedUser(prisma, { phone: '0700111222', password: PASSWORD, pin });
      const { body } = await login('0700111222', PASSWORD).expect(200);
      return body.access_token as string;
    }

    it('confirms a correct PIN and logs PIN_OK', async () => {
      const token = await tokenFor(PIN);

      const res = await http()
        .post('/api/auth/pin/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: PIN })
        .expect(200);

      expect(res.body).toEqual({ valid: true });
      expect(await events()).toEqual(['LOGIN_OK', 'PIN_OK']);
    });

    it('reports a wrong PIN as invalid and logs PIN_FAIL', async () => {
      const token = await tokenFor(PIN);

      const res = await http()
        .post('/api/auth/pin/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '9999' })
        .expect(200);

      expect(res.body).toEqual({ valid: false });
      expect(await events()).toEqual(['LOGIN_OK', 'PIN_FAIL']);
    });

    it('rejects a malformed PIN before any lookup', async () => {
      const token = await tokenFor(PIN);

      await http()
        .post('/api/auth/pin/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: 'abcd' })
        .expect(400);

      expect(await events()).toEqual(['LOGIN_OK']);
    });
  });

  describe('PIN change', () => {
    it('replaces the PIN when the current one is supplied', async () => {
      await seedUser(prisma, { phone: '0700111222', password: PASSWORD, pin: PIN });
      const { body } = await login('0700111222', PASSWORD).expect(200);
      const token = body.access_token as string;

      await http()
        .patch('/api/auth/pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_pin: PIN, new_pin: '7351' })
        .expect(204);

      await http()
        .post('/api/auth/pin/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '7351' })
        .expect(200)
        .expect({ valid: true });

      await http()
        .post('/api/auth/pin/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: PIN })
        .expect(200)
        .expect({ valid: false });
    });

    it('refuses a change when the current PIN is wrong', async () => {
      await seedUser(prisma, { phone: '0700111222', password: PASSWORD, pin: PIN });
      const { body } = await login('0700111222', PASSWORD).expect(200);

      await http()
        .patch('/api/auth/pin')
        .set('Authorization', `Bearer ${body.access_token}`)
        .send({ current_pin: '0000', new_pin: '7351' })
        .expect(401);

      expect(await events()).toEqual(['LOGIN_OK', 'PIN_FAIL']);
    });
  });
});
