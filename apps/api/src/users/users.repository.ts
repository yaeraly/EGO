import { Injectable } from '@nestjs/common';
import { Prisma, user_status, users } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Columns safe to return. `password_hash` and `pin_hash` are absent by
 * construction, so no response path can leak a credential digest.
 */
export const PUBLIC_USER = {
  id: true,
  full_name: true,
  phone: true,
  role: true,
  status: true,
  max_discount_pct: true,
  bonus_rate_pct: true,
  base_salary: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.usersSelect;

export type PublicUser = Prisma.usersGetPayload<{ select: typeof PUBLIC_USER }>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: Prisma.usersCreateInput): Promise<PublicUser> {
    return this.prisma.users.create({ data, select: PUBLIC_USER });
  }

  findAll(): Promise<PublicUser[]> {
    return this.prisma.users.findMany({
      select: PUBLIC_USER,
      orderBy: { created_at: 'asc' },
    });
  }

  findPublicById(id: string): Promise<PublicUser | null> {
    return this.prisma.users.findUnique({ where: { id }, select: PUBLIC_USER });
  }

  findIdById(id: string, db: Db = this.prisma): Promise<{ id: string } | null> {
    return db.users.findUnique({ where: { id }, select: { id: true } });
  }

  update(
    id: string,
    data: Prisma.usersUpdateInput,
  ): Promise<PublicUser> {
    return this.prisma.users.update({ where: { id }, data, select: PUBLIC_USER });
  }

  setStatus(id: string, status: user_status): Promise<PublicUser> {
    return this.prisma.users.update({
      where: { id },
      data: { status, updated_at: new Date() },
      select: PUBLIC_USER,
    });
  }

  async setPinHash(id: string, pinHash: string): Promise<void> {
    await this.prisma.users.update({
      where: { id },
      data: { pin_hash: pinHash, updated_at: new Date() },
    });
  }

  /** Credentials leave the repository only for verification, never for a response. */
  findCredentialsByPhone(phone: string): Promise<
    Pick<users, 'id' | 'full_name' | 'role' | 'phone' | 'status' | 'password_hash'> | null
  > {
    return this.prisma.users.findUnique({
      where: { phone },
      select: {
        id: true,
        full_name: true,
        role: true,
        phone: true,
        status: true,
        password_hash: true,
      },
    });
  }

  findPinHash(id: string): Promise<{ pin_hash: string } | null> {
    return this.prisma.users.findUnique({
      where: { id },
      select: { pin_hash: true },
    });
  }

  findAuthContext(id: string): Promise<
    Pick<users, 'id' | 'role' | 'phone' | 'status'> | null
  > {
    return this.prisma.users.findUnique({
      where: { id },
      select: { id: true, role: true, phone: true, status: true },
    });
  }

  count(where: Prisma.usersWhereInput): Promise<number> {
    return this.prisma.users.count({ where });
  }
}
