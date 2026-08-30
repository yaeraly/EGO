import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { resetDatabase } from './app-harness';
import { createAccount, seedUser } from './fixtures';

export const OWNER_PASSWORD = 'module-one-owner-password';
export const STAFF_PASSWORD = 'module-one-staff-password';
export const BUSINESS_DATE = '2026-03-15';

export interface Module1Context {
  app: INestApplication;
  prisma: PrismaClient;
  ownerToken: string;
  staffToken: string;
  ownerId: string;
  kgsAccount: string;
  cnyAccount: string;
  usdAccount: string;
}

/**
 * Rebuilds the accounts and users every Module 1 test starts from: an OWNER,
 * a SALES_MANAGER (to check the OWNER-only routes), and one till per currency.
 */
export async function resetModule1(
  app: INestApplication,
  prisma: PrismaClient,
): Promise<Omit<Module1Context, 'app' | 'prisma'>> {
  await resetDatabase(prisma);

  const owner = await seedUser(prisma, {
    phone: '0700000001',
    password: OWNER_PASSWORD,
    pin: '12345678',
    role: 'OWNER',
    full_name: 'Owner',
  });
  await seedUser(prisma, {
    phone: '0700000002',
    password: STAFF_PASSWORD,
    pin: '87654321',
    role: 'SALES_MANAGER',
    full_name: 'Seller',
  });

  const login = async (phone: string, password: string): Promise<string> => {
    const { body } = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ phone, password })
      .expect(200);
    return body.access_token as string;
  };

  return {
    ownerId: owner.id,
    ownerToken: await login('0700000001', OWNER_PASSWORD),
    staffToken: await login('0700000002', STAFF_PASSWORD),
    kgsAccount: await createAccount(prisma, { name: 'OWNER Cash', currency: 'KGS' }),
    cnyAccount: await createAccount(prisma, { name: 'CNY Cash', currency: 'CNY' }),
    usdAccount: await createAccount(prisma, { name: 'USD Cash', currency: 'USD' }),
  };
}
