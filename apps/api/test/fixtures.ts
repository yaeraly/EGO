import { Prisma, PrismaClient, account_type, currency_code, doc_status, doc_type, user_role, user_status } from '@prisma/client';
import * as argon2 from 'argon2';

export interface SeededUser {
  id: string;
  phone: string;
  password: string;
  pin: string;
}

/**
 * Creates a user the way UsersService does — argon2id digests only, never the
 * plaintext — so credential-leak tests exercise a realistic row.
 */
export async function seedUser(
  prisma: PrismaClient,
  overrides: {
    phone: string;
    password: string;
    pin: string;
    role?: user_role;
    status?: user_status;
    full_name?: string;
  },
): Promise<SeededUser> {
  const [password_hash, pin_hash] = await Promise.all([
    argon2.hash(overrides.password, { type: argon2.argon2id }),
    argon2.hash(overrides.pin, { type: argon2.argon2id }),
  ]);

  const user = await prisma.users.create({
    data: {
      full_name: overrides.full_name ?? 'Test User',
      phone: overrides.phone,
      role: overrides.role ?? user_role.SALES_MANAGER,
      status: overrides.status ?? user_status.ACTIVE,
      password_hash,
      pin_hash,
    },
    select: { id: true },
  });

  return {
    id: user.id,
    phone: overrides.phone,
    password: overrides.password,
    pin: overrides.pin,
  };
}

export async function createAccount(
  prisma: PrismaClient,
  params: {
    name: string;
    type?: account_type;
    currency?: currency_code;
    ownerUser?: string | null;
  },
): Promise<string> {
  const account = await prisma.payment_accounts.create({
    data: {
      name: params.name,
      type: params.type ?? account_type.CASH,
      currency: params.currency ?? currency_code.KGS,
      owner_user: params.ownerUser ?? null,
    },
    select: { id: true },
  });
  return account.id;
}

/**
 * Puts an opening balance on an account.
 *
 * Stands in for the CAP document that Module 1 introduces: until capital entry
 * exists, there is no in-system way to bring money in, and a transfer test
 * needs something to transfer.
 */
export async function fundAccount(
  prisma: PrismaClient,
  params: { accountId: string; amount: string; userId: string },
): Promise<void> {
  const document = await prisma.documents.create({
    data: {
      doc_type: doc_type.CAP,
      doc_number: `CAP-2026-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
      business_date: new Date('2026-01-01T00:00:00.000Z'),
      status: doc_status.CONFIRMED,
      created_by: params.userId,
      confirmed_by: params.userId,
      confirmed_at: new Date(),
    },
    select: { id: true },
  });

  await prisma.account_movements.create({
    data: {
      account_id: params.accountId,
      document_id: document.id,
      amount: new Prisma.Decimal(params.amount),
    },
  });
}
