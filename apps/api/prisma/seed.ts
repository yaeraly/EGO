import { PrismaClient, user_role } from '@prisma/client';
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

async function main(): Promise<void> {
  await seedBootstrapOwner();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
