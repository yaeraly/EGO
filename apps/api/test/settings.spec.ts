import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { SettingKey } from '../src/settings/setting-keys';
import { SettingsService } from '../src/settings/settings.service';
import { createTestApp, resetDatabase } from './app-harness';
import { seedUser } from './fixtures';

const OWNER_PASSWORD = 'settings-owner-password';
const STAFF_PASSWORD = 'settings-staff-password';

describe('Settings (Module 0.5)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let settings: SettingsService;
  let ownerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    settings = app.get(SettingsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${staffToken}`);

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
      pin: '12345678',
      role: 'OWNER',
    });
    await seedUser(prisma, {
      phone: '0700000002',
      password: STAFF_PASSWORD,
      pin: '87654321',
      role: 'SALES_MANAGER',
    });
    ownerToken = await login('0700000001', OWNER_PASSWORD);
    staffToken = await login('0700000002', STAFF_PASSWORD);
  });

  describe('authorization', () => {
    it.each([
      ['GET', (p: string) => http().get(p)],
      ['PUT', (p: string) => http().put(p).send({ value: 1 })],
      ['DELETE', (p: string) => http().delete(p)],
    ])('refuses a SALES_MANAGER on %s', async (_verb, call) => {
      await asStaff(call('/api/settings/some.key')).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await http().get('/api/settings').expect(401);
    });
  });

  describe('CRUD', () => {
    it('creates a setting and audits it', async () => {
      const res = await asOwner(http().put('/api/settings/shop.opening_hour'))
        .send({ value: 9, description: 'Hour the shop opens' })
        .expect(200);

      expect(res.body).toMatchObject({
        key: 'shop.opening_hour',
        value: 9,
        description: 'Hour the shop opens',
      });
      expect(res.body.updated_by).not.toBeNull();

      const audit = await prisma.audit_log.findFirst({
        where: { entity: 'settings', entity_id: 'shop.opening_hour' },
      });
      expect(audit?.action).toBe('SETTING_CREATED');
      expect(audit?.new_value).toBe(9);
    });

    it('replaces a value and records both sides', async () => {
      await asOwner(http().put('/api/settings/shop.opening_hour'))
        .send({ value: 9 })
        .expect(200);
      await asOwner(http().put('/api/settings/shop.opening_hour'))
        .send({ value: 10 })
        .expect(200);

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'SETTING_UPDATED' },
      });
      expect(audit?.old_value).toBe(9);
      expect(audit?.new_value).toBe(10);
    });

    it('stores structured values', async () => {
      const value = { weekdays: [1, 2, 3], note: 'partial' };

      const res = await asOwner(http().put('/api/settings/shop.schedule'))
        .send({ value })
        .expect(200);

      expect(res.body.value).toEqual(value);
    });

    it('lists settings by key', async () => {
      await asOwner(http().put('/api/settings/b.key')).send({ value: 2 }).expect(200);
      await asOwner(http().put('/api/settings/a.key')).send({ value: 1 }).expect(200);

      const res = await asOwner(http().get('/api/settings')).expect(200);

      expect(res.body.map((s: { key: string }) => s.key)).toEqual([
        'a.key',
        'b.key',
      ]);
    });

    it('deletes a setting and audits it', async () => {
      await asOwner(http().put('/api/settings/temp.key'))
        .send({ value: 1 })
        .expect(200);

      await asOwner(http().delete('/api/settings/temp.key')).expect(204);

      await asOwner(http().get('/api/settings/temp.key')).expect(404);
      expect(
        await prisma.audit_log.count({ where: { action: 'SETTING_DELETED' } }),
      ).toBe(1);
    });

    it('404s on an unknown key', async () => {
      await asOwner(http().get('/api/settings/no.such.key')).expect(404);
    });

    it('requires the value property', async () => {
      await asOwner(http().put('/api/settings/some.key'))
        .send({ description: 'no value' })
        .expect(400);
    });
  });

  describe('unconfigured settings fail loudly', () => {
    it('accepts an explicit null as "not configured"', async () => {
      const res = await asOwner(http().put(`/api/settings/${SettingKey.BONUS_DEFAULT_RATE_PCT}`))
        .send({ value: null, description: 'unset' })
        .expect(200);

      expect(res.body.value).toBeNull();
    });

    it('refuses to read an unconfigured setting rather than defaulting it', async () => {
      await asOwner(http().put(`/api/settings/${SettingKey.CATEGORY_SILVER_THRESHOLD_KGS}`))
        .send({ value: null })
        .expect(200);

      await expect(
        settings.requireDecimal(SettingKey.CATEGORY_SILVER_THRESHOLD_KGS),
      ).rejects.toThrow(/not configured/);
    });

    it('reads a configured threshold as an exact Decimal', async () => {
      await asOwner(http().put(`/api/settings/${SettingKey.SALE_PIN_THRESHOLD_KGS}`))
        .send({ value: 50000 })
        .expect(200);

      const threshold = await settings.requireDecimal(
        SettingKey.SALE_PIN_THRESHOLD_KGS,
      );
      expect(threshold.toFixed(2)).toBe('50000.00');
    });

    it('keeps a decimal string exact', async () => {
      await asOwner(http().put(`/api/settings/${SettingKey.BONUS_DEFAULT_RATE_PCT}`))
        .send({ value: '2.75' })
        .expect(200);

      const rate = await settings.requireDecimal(
        SettingKey.BONUS_DEFAULT_RATE_PCT,
      );
      expect(rate.toFixed(2)).toBe('2.75');
    });

    it('refuses a non-numeric value where a number is required', async () => {
      await asOwner(http().put(`/api/settings/${SettingKey.BONUS_DEFAULT_RATE_PCT}`))
        .send({ value: { nested: true } })
        .expect(200);

      await expect(
        settings.requireDecimal(SettingKey.BONUS_DEFAULT_RATE_PCT),
      ).rejects.toThrow(/not configured|not a number/);
    });

    it('404s when the key was never seeded', async () => {
      await expect(
        settings.requireDecimal(SettingKey.CATEGORY_VIP_THRESHOLD_KGS),
      ).rejects.toThrow(/not found/);
    });
  });
});
