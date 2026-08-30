import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, resetDatabase } from './app-harness';
import { seedUser } from './fixtures';

const OWNER_PASSWORD = 'owner-password-1';
const STAFF_PASSWORD = 'staff-password-1';

describe('Users (Module 0.2)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerToken: string;
  let staffToken: string;
  let staffId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());

  const login = async (phone: string, password: string): Promise<string> => {
    const { body } = await http()
      .post('/api/auth/login')
      .send({ phone, password })
      .expect(200);
    return body.access_token as string;
  };

  beforeEach(async () => {
    await resetDatabase(prisma);

    await seedUser(prisma, {
      phone: '0700000001',
      password: OWNER_PASSWORD,
      pin: '11112222',
      role: 'OWNER',
      full_name: 'Owner',
    });
    const staff = await seedUser(prisma, {
      phone: '0700000002',
      password: STAFF_PASSWORD,
      pin: '33334444',
      role: 'SALES_MANAGER',
      full_name: 'Staff',
    });
    staffId = staff.id;

    ownerToken = await login('0700000001', OWNER_PASSWORD);
    staffToken = await login('0700000002', STAFF_PASSWORD);
  });

  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${staffToken}`);

  describe('authorization (§2)', () => {
    it('lets OWNER list users', async () => {
      const res = await asOwner(http().get('/api/users')).expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0]).not.toHaveProperty('password_hash');
      expect(res.body[0]).not.toHaveProperty('pin_hash');
    });

    it.each([
      ['GET', '/api/users'],
      ['POST', '/api/users'],
    ])('refuses SALES_MANAGER on %s %s', async (method, path) => {
      const req =
        method === 'GET' ? http().get(path) : http().post(path).send({});

      await asStaff(req).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await http().get('/api/users').expect(401);
    });
  });

  describe('create', () => {
    it('creates a user and returns no credential digest', async () => {
      const res = await asOwner(http().post('/api/users'))
        .send({
          full_name: 'New Manager',
          phone: '0700000003',
          role: 'SALES_MANAGER',
          password: 'new-manager-pass',
          pin: '55556666',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        full_name: 'New Manager',
        phone: '0700000003',
        role: 'SALES_MANAGER',
        status: 'ACTIVE',
      });
      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body).not.toHaveProperty('pin_hash');
    });

    it('rejects a duplicate phone with 409', async () => {
      await asOwner(http().post('/api/users'))
        .send({
          full_name: 'Clash',
          phone: '0700000002',
          role: 'SALES_MANAGER',
          password: 'clash-password',
          pin: '55556666',
        })
        .expect(409);
    });

    it.each([
      ['a short password', { password: 'short' }],
      ['a non-numeric PIN', { pin: 'abcd' }],
      ['a too-short PIN', { pin: '12' }],
      ['an unknown role', { role: 'ADMIN' }],
    ])('rejects %s', async (_label, override) => {
      await asOwner(http().post('/api/users'))
        .send({
          full_name: 'Invalid',
          phone: '0700000004',
          role: 'SALES_MANAGER',
          password: 'valid-password',
          pin: '55556666',
          ...override,
        })
        .expect(400);
    });
  });

  describe('money and percentages are Decimal, never float', () => {
    it('round-trips a 14,2 salary exactly', async () => {
      const res = await asOwner(http().post('/api/users'))
        .send({
          full_name: 'Paid Manager',
          phone: '0700000005',
          role: 'SALES_MANAGER',
          password: 'paid-manager-pw',
          pin: '55556666',
          base_salary: '1234567.89',
          max_discount_pct: '12.50',
          bonus_rate_pct: '3.75',
        })
        .expect(201);

      expect(res.body.base_salary).toBe('1234567.89');
      expect(res.body.max_discount_pct).toBe('12.5');
      expect(res.body.bonus_rate_pct).toBe('3.75');

      const stored = await prisma.users.findUnique({
        where: { id: res.body.id },
        select: { base_salary: true },
      });
      expect(stored?.base_salary.toString()).toBe('1234567.89');
    });

    it('rejects a JSON number for a monetary field', async () => {
      await asOwner(http().post('/api/users'))
        .send({
          full_name: 'Float Manager',
          phone: '0700000006',
          role: 'SALES_MANAGER',
          password: 'float-manager-pw',
          pin: '55556666',
          base_salary: 1234567.89,
        })
        .expect(400);
    });
  });

  describe('deactivation instead of deletion (Security)', () => {
    it('exposes no delete route', async () => {
      await asOwner(http().delete(`/api/users/${staffId}`)).expect(404);

      expect(await prisma.users.count()).toBe(2);
    });

    it.each(['INACTIVE', 'BLOCKED'])(
      'keeps the row but stops login when set to %s',
      async (status) => {
        await asOwner(http().patch(`/api/users/${staffId}/status`))
          .send({ status })
          .expect(200)
          .expect((res) => expect(res.body.status).toBe(status));

        await http()
          .post('/api/auth/login')
          .send({ phone: '0700000002', password: STAFF_PASSWORD })
          .expect(401);

        expect(
          await prisma.users.findUnique({ where: { id: staffId } }),
        ).not.toBeNull();
      },
    );

    it('invalidates an already-issued token', async () => {
      await asOwner(http().patch(`/api/users/${staffId}/status`))
        .send({ status: 'BLOCKED' })
        .expect(200);

      await http()
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(401);
    });

    it('lets OWNER reactivate a user', async () => {
      await asOwner(http().patch(`/api/users/${staffId}/status`))
        .send({ status: 'INACTIVE' })
        .expect(200);
      await asOwner(http().patch(`/api/users/${staffId}/status`))
        .send({ status: 'ACTIVE' })
        .expect(200);

      await login('0700000002', STAFF_PASSWORD);
    });
  });

  describe('update', () => {
    it('changes profile fields', async () => {
      const res = await asOwner(http().patch(`/api/users/${staffId}`))
        .send({ full_name: 'Renamed Staff', max_discount_pct: '7.25' })
        .expect(200);

      expect(res.body.full_name).toBe('Renamed Staff');
      expect(res.body.max_discount_pct).toBe('7.25');
    });

    it('refuses a credential field on the profile route', async () => {
      await asOwner(http().patch(`/api/users/${staffId}`))
        .send({ password: 'sneaky-new-password' })
        .expect(400);
    });

    it('404s on an unknown user', async () => {
      await asOwner(
        http().patch('/api/users/00000000-0000-0000-0000-000000000000'),
      )
        .send({ full_name: 'Ghost' })
        .expect(404);
    });

    it('400s on a malformed id', async () => {
      await asOwner(http().get('/api/users/not-a-uuid')).expect(400);
    });
  });

  describe('OWNER PIN reset', () => {
    it('sets a new PIN without knowing the old one', async () => {
      await asOwner(http().patch(`/api/users/${staffId}/pin`))
        .send({ new_pin: '99998888' })
        .expect(204);

      await http()
        .post('/api/auth/pin/verify')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '99998888' })
        .expect(200)
        .expect({ valid: true });
    });

    it('refuses a SALES_MANAGER resetting another PIN', async () => {
      await asStaff(http().patch(`/api/users/${staffId}/pin`))
        .send({ new_pin: '99998888' })
        .expect(403);
    });
  });
});
