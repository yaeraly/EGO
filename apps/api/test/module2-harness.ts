import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { resetDatabase } from './app-harness';
import { createAccount, seedUser } from './fixtures';

export const OWNER_PASSWORD = 'module-two-owner-password';
export const STAFF_PASSWORD = 'module-two-staff-password';

export interface Module2Context {
  ownerId: string;
  staffId: string;
  ownerToken: string;
  staffToken: string;
  kgsAccount: string;
  cnyAccount: string;
  usdAccount: string;
  supplierId: string;
  cargoCompanyId: string;
  productIds: string[];
  /** The SKUs the system issued for them (§12-Б.9.1). */
  productSkus: string[];
}

/**
 * Everything a purchase needs to exist: two users, a till per currency, a
 * supplier, a carrier and a few products to order.
 */
export async function resetModule2(
  app: INestApplication,
  prisma: PrismaClient,
): Promise<Module2Context> {
  await resetDatabase(prisma);

  const owner = await seedUser(prisma, {
    phone: '0700000001',
    password: OWNER_PASSWORD,
    pin: '12345678',
    role: 'OWNER',
    full_name: 'Owner',
  });
  const staff = await seedUser(prisma, {
    phone: '0700000002',
    password: STAFF_PASSWORD,
    pin: '87654321',
    role: 'SALES_MANAGER',
    full_name: 'Seller',
  });

  const http = () => request(app.getHttpServer());
  const login = async (phone: string, password: string): Promise<string> => {
    const { body } = await http()
      .post('/api/auth/login')
      .send({ phone, password })
      .expect(200);
    return body.access_token as string;
  };

  const ownerToken = await login('0700000001', OWNER_PASSWORD);
  const staffToken = await login('0700000002', STAFF_PASSWORD);
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ownerToken}`);

  const { body: supplier } = await asOwner(http().post('/api/suppliers'))
    .send({ name: 'Yiwu Partner', contact: 'wechat: yiwu-partner' })
    .expect(201);

  const { body: cargo } = await asOwner(http().post('/api/cargo-companies'))
    .send({ name: 'Silk Road Cargo' })
    .expect(201);

  const productIds: string[] = [];
  const productSkus: string[] = [];
  // The SKU is the system's to issue (§12-Б.9.1), so the fixture names the
  // products, lets the server number them, and hands the numbers on.
  for (const name of ['Мотор 1800W', 'Аккумулятор 58Ah', 'Контроллер']) {
    const { body } = await asOwner(http().post('/api/products'))
      .send({ name, weight_kg: '12.500' })
      .expect(201);
    productIds.push(body.id as string);
    productSkus.push(body.sku as string);
  }

  return {
    ownerId: owner.id,
    staffId: staff.id,
    ownerToken,
    staffToken,
    kgsAccount: await createAccount(prisma, { name: 'OWNER Cash', currency: 'KGS' }),
    cnyAccount: await createAccount(prisma, { name: 'CNY Cash', currency: 'CNY' }),
    usdAccount: await createAccount(prisma, { name: 'USD Cash', currency: 'USD' }),
    supplierId: supplier.id as string,
    cargoCompanyId: cargo.id as string,
    productIds,
    productSkus,
  };
}

/** Drives the create → confirm pair every document in the system uses. */
export function documentFlow(
  app: INestApplication,
  token: string,
): {
  create: (path: string, body: Record<string, unknown>) => request.Test;
  confirm: (documentId: string) => request.Test;
  createAndConfirm: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ id: string; doc_number: string }>;
} {
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  const create = (path: string, body: Record<string, unknown>) =>
    auth(http().post(path)).send(body);
  const confirm = (documentId: string) =>
    auth(http().post(`/api/documents/${documentId}/confirm`));

  return {
    create,
    confirm,
    createAndConfirm: async (path, body) => {
      const { body: document } = await create(path, body).expect(201);
      await confirm(document.id).expect(201);
      return { id: document.id as string, doc_number: document.doc_number as string };
    },
  };
}

/**
 * Puts KGS in, then buys CNY at a stated rate — the real route yuan take into
 * the business (§43: capital → currency purchase → supplier).
 */
/**
 * Moves a confirmed order to "left the supplier's warehouse" (§6, stage 5).
 *
 * That is the moment the debt for the goods falls due (§6.5), so any test
 * about a supplier payable has to get the order there first.
 */
export async function shipPurchase(
  app: INestApplication,
  token: string,
  purchaseId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/purchases/${purchaseId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'LEFT_SUPPLIER', reason: 'shipped' })
    .expect(201);
}

export async function buyCurrency(
  app: INestApplication,
  ctx: Module2Context,
  params: { kgs: string; foreign: string; toAccount: string },
): Promise<void> {
  const flow = documentFlow(app, ctx.ownerToken);

  await flow.createAndConfirm('/api/capital', {
    source: 'OWNER',
    account_id: ctx.kgsAccount,
    amount: params.kgs,
  });

  await flow.createAndConfirm('/api/currency-exchanges', {
    from_account: ctx.kgsAccount,
    to_account: params.toAccount,
    given_amount: params.kgs,
    received_amount: params.foreign,
  });
}
