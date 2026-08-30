import { PrismaClient, account_type, currency_code, user_role, user_status } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/**
 * Bootstrap seed.
 *
 * Creates the first OWNER, without whom nobody can log in and no user can be
 * created (user administration is OWNER-only, §2). Idempotent: it does nothing
 * once an OWNER exists, so it is safe to re-run on every deploy.
 */
async function seedBootstrapOwner(): Promise<void> {
  const existing = await prisma.users.count({
    where: { role: user_role.OWNER },
  });
  if (existing > 0) {
    console.log(`OWNER already present (${existing}); skipping bootstrap.`);
    return;
  }

  const phone = required('BOOTSTRAP_OWNER_PHONE');
  const password = required('BOOTSTRAP_OWNER_PASSWORD');
  const pin = required('BOOTSTRAP_OWNER_PIN');
  const fullName = process.env.BOOTSTRAP_OWNER_NAME ?? 'Owner';

  if (password.length < 8) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD must be at least 8 characters');
  }
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('BOOTSTRAP_OWNER_PIN must be 4 to 8 digits');
  }

  const [password_hash, pin_hash] = await Promise.all([
    argon2.hash(password, { type: argon2.argon2id }),
    argon2.hash(pin, { type: argon2.argon2id }),
  ]);

  const owner = await prisma.users.create({
    data: {
      full_name: fullName,
      phone,
      role: user_role.OWNER,
      password_hash,
      pin_hash,
    },
    select: { id: true, phone: true },
  });

  // The credentials themselves are never printed — only that the row exists.
  console.log(`Bootstrap OWNER created: ${owner.phone} (${owner.id})`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set to run the bootstrap seed`);
  }
  return value;
}

/**
 * Per-user account set (§19). Each person who handles money gets their own
 * till and mobile-banking accounts, so a balance is always attributable to
 * one person rather than pooled.
 *
 * ASSUMPTION: MBank and O!Bank are typed BANK rather than EWALLET. Both are
 * licensed banks' apps; the knowledge base does not state the classification.
 * Confirm before real data is entered — the type is fixed once movements
 * exist.
 */
const PER_USER_ACCOUNTS: { suffix: string; type: account_type }[] = [
  { suffix: 'Cash', type: account_type.CASH },
  { suffix: 'MBank', type: account_type.BANK },
  { suffix: 'O!Bank', type: account_type.BANK },
];

/** Company-wide foreign currency tills, held by no single person. */
const COMPANY_ACCOUNTS: {
  name: string;
  type: account_type;
  currency: currency_code;
}[] = [
  { name: 'CNY Cash', type: account_type.CASH, currency: currency_code.CNY },
  { name: 'USD Cash', type: account_type.CASH, currency: currency_code.USD },
];

async function seedPaymentAccounts(): Promise<void> {
  const staff = await prisma.users.findMany({
    where: { status: user_status.ACTIVE },
    select: { id: true, full_name: true },
    orderBy: { created_at: 'asc' },
  });

  let created = 0;

  for (const person of staff) {
    for (const { suffix, type } of PER_USER_ACCOUNTS) {
      const name = `${person.full_name} ${suffix}`;
      const exists = await prisma.payment_accounts.findFirst({
        where: { name, owner_user: person.id },
        select: { id: true },
      });
      if (exists) {
        continue;
      }
      await prisma.payment_accounts.create({
        data: {
          name,
          type,
          currency: currency_code.KGS,
          owner_user: person.id,
        },
      });
      created += 1;
    }
  }

  for (const account of COMPANY_ACCOUNTS) {
    const exists = await prisma.payment_accounts.findFirst({
      where: { name: account.name, owner_user: null },
      select: { id: true },
    });
    if (exists) {
      continue;
    }
    await prisma.payment_accounts.create({
      data: { ...account, owner_user: null },
    });
    created += 1;
  }

  console.log(
    created > 0
      ? `Payment accounts created: ${created}`
      : 'Payment accounts already present; nothing to create.',
  );
}

async function main(): Promise<void> {
  await seedBootstrapOwner();
  await seedPaymentAccounts();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
