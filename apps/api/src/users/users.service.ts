import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, user_status } from '@prisma/client';
import { toOptionalDecimal } from '../common/decimal';
import { hashSecret } from '../common/secret-hash';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * Columns safe to return. `password_hash` and `pin_hash` are absent by
 * construction — no response path can leak a credential digest.
 */
const PUBLIC_USER = {
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
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const [password_hash, pin_hash] = await Promise.all([
      hashSecret(dto.password),
      hashSecret(dto.pin),
    ]);

    try {
      return await this.prisma.users.create({
        data: {
          full_name: dto.full_name,
          phone: dto.phone,
          role: dto.role,
          password_hash,
          pin_hash,
          max_discount_pct: toOptionalDecimal(
            dto.max_discount_pct,
            'max_discount_pct',
          ),
          bonus_rate_pct: toOptionalDecimal(dto.bonus_rate_pct, 'bonus_rate_pct'),
          base_salary: toOptionalDecimal(dto.base_salary, 'base_salary'),
        },
        select: PUBLIC_USER,
      });
    } catch (error) {
      throw this.translatePhoneConflict(error);
    }
  }

  findAll(): Promise<PublicUser[]> {
    return this.prisma.users.findMany({
      select: PUBLIC_USER,
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.prisma.users.findUnique({
      where: { id },
      select: PUBLIC_USER,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findOne(id);

    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          full_name: dto.full_name,
          phone: dto.phone,
          role: dto.role,
          max_discount_pct: toOptionalDecimal(
            dto.max_discount_pct,
            'max_discount_pct',
          ),
          bonus_rate_pct: toOptionalDecimal(dto.bonus_rate_pct, 'bonus_rate_pct'),
          base_salary: toOptionalDecimal(dto.base_salary, 'base_salary'),
          updated_at: new Date(),
        },
        select: PUBLIC_USER,
      });
    } catch (error) {
      throw this.translatePhoneConflict(error);
    }
  }

  /**
   * A departing employee is deactivated, never deleted (Security): their
   * documents, movements and audit trail must stay attributable. There is
   * deliberately no delete operation on this service.
   */
  async setStatus(id: string, status: user_status): Promise<PublicUser> {
    await this.findOne(id);
    return this.prisma.users.update({
      where: { id },
      data: { status, updated_at: new Date() },
      select: PUBLIC_USER,
    });
  }

  /** OWNER resets another user's PIN without knowing the old one. */
  async resetPin(id: string, newPin: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.users.update({
      where: { id },
      data: { pin_hash: await hashSecret(newPin), updated_at: new Date() },
    });
  }

  private translatePhoneConflict(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('phone is already registered');
    }
    return error;
  }
}

export { PUBLIC_USER };
