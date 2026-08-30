import { PrismaClient, user_role, user_status } from '@prisma/client';
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
