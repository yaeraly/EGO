import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, user_status } from '@prisma/client';
import { toOptionalDecimal } from '../common/decimal';
import { hashSecret } from '../common/secret-hash';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser, UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const [password_hash, pin_hash] = await Promise.all([
      hashSecret(dto.password),
      hashSecret(dto.pin),
    ]);

    try {
      return await this.repository.insert({
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
      });
    } catch (error) {
      throw this.translatePhoneConflict(error);
    }
  }

  findAll(): Promise<PublicUser[]> {
    return this.repository.findAll();
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.repository.findPublicById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /** Existence check for other domains that reference a user. */
  async requireExists(id: string): Promise<void> {
    const user = await this.repository.findIdById(id);
    if (!user) {
      throw new NotFoundException('owner_user does not exist');
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findOne(id);

    try {
      return await this.repository.update(id, {
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
    return this.repository.setStatus(id, status);
  }

  /** OWNER resets another user's PIN without knowing the old one. */
  async resetPin(id: string, newPin: string): Promise<void> {
    await this.findOne(id);
    await this.repository.setPinHash(id, await hashSecret(newPin));
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

export type { PublicUser };
