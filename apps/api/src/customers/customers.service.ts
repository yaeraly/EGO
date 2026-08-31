import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, customer_category, customers } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toOptionalDecimal } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import {
  CreateCustomerDto,
  SetCategoryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * What Walk-in may not do (§11.1.2).
 *
 * Every one of these needs a person the business can come back to — a debt
 * to collect, an advance to return, a history to price against. Walk-in is a
 * single technical customer standing in for everyone who did not give a name,
 * so attaching any of them to it would attach them to strangers at large.
 */
export const WALK_IN_FORBIDDEN = {
  DEBT: 'карызга сатуу',
  PARTIAL_PAYMENT: 'жарым-жартылай төлөнгөн сатуу',
  CREDIT_LIMIT: 'кредиттик лимит',
  RESERVATION: 'бронь',
  ADVANCE: 'аванс',
  CATEGORY: 'категория',
} as const;

export type WalkInForbidden = keyof typeof WALK_IN_FORBIDDEN;

/**
 * Customers (§11, §12).
 *
 * Two kinds live in one table: registered people, and the single Walk-in
 * customer that unidentified retail sales are booked against (§11.1). The
 * difference is enforced here rather than in the UI, because the UI is not
 * what protects the ledger.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CustomersRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCustomerDto, userId: string): Promise<customers> {
    const limit = toOptionalDecimal(
      dto.individual_credit_limit,
      'individual_credit_limit',
    );
    if (limit && limit.isNegative()) {
      throw new BadRequestException('individual_credit_limit cannot be negative');
    }

    const customer = await this.repository.insert({
      name: dto.name.trim(),
      phone: dto.phone?.trim() || null,
      ctype: dto.ctype ?? 'RETAIL',
      individual_credit_limit: limit ?? null,
    });

    await this.audit.log({
      userId,
      entity: 'customers',
      entityId: customer.id,
      action: 'CUSTOMER_CREATED',
      newValue: {
        name: customer.name,
        phone: customer.phone,
        ctype: customer.ctype,
        individual_credit_limit: limit?.toFixed(2) ?? null,
      },
    });

    return customer;
  }

  findMany(filter: { query?: string; includeInactive?: boolean; limit?: number }) {
    return this.repository.findMany(filter);
  }

  async findOne(id: string, db?: Db): Promise<customers> {
    const customer = await this.repository.findById(id, db);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  /**
   * The single Walk-in customer (§11.1).
   *
   * `uq_single_walkin` guarantees there is at most one; the seed creates it,
   * and its absence is a broken installation rather than something to paper
   * over by creating a second one here.
   */
  async walkIn(db?: Db): Promise<customers> {
    const customer = await this.repository.findWalkIn(db);
    if (!customer) {
      throw new ConflictException(
        'No Walk-in customer exists; the system needs exactly one (§11.1) — run the seed',
      );
    }
    return customer;
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    userId: string,
  ): Promise<customers> {
    const before = await this.findOne(id);

    if (before.is_walk_in) {
      if (dto.individual_credit_limit !== undefined) {
        throw this.walkInRefusal('CREDIT_LIMIT');
      }
      if (dto.is_active === false) {
        throw new ConflictException(
          'The Walk-in customer cannot be deactivated: retail sales have nowhere to go (§11.1)',
        );
      }
    }

    const limit = toOptionalDecimal(
      dto.individual_credit_limit,
      'individual_credit_limit',
    );
    if (limit && limit.isNegative()) {
      throw new BadRequestException('individual_credit_limit cannot be negative');
    }

    const customer = await this.repository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
      ...(dto.ctype !== undefined ? { ctype: dto.ctype } : {}),
      ...(limit !== undefined ? { individual_credit_limit: limit } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
    });

    await this.audit.log({
      userId,
      entity: 'customers',
      entityId: id,
      action: 'CUSTOMER_UPDATED',
      oldValue: {
        name: before.name,
        phone: before.phone,
        ctype: before.ctype,
        individual_credit_limit: before.individual_credit_limit?.toFixed(2) ?? null,
        is_active: before.is_active,
      },
      newValue: {
        name: customer.name,
        phone: customer.phone,
        ctype: customer.ctype,
        individual_credit_limit:
          customer.individual_credit_limit?.toFixed(2) ?? null,
        is_active: customer.is_active,
      },
    });

    return customer;
  }

  /**
   * The OWNER's own category, which the monthly job then leaves alone (§12.1).
   */
  async setCategory(
    id: string,
    dto: SetCategoryDto,
    userId: string,
  ): Promise<customers> {
    const before = await this.findOne(id);
    if (before.is_walk_in) {
      throw this.walkInRefusal('CATEGORY');
    }

    const customer = await this.repository.update(id, {
      category: dto.category,
      category_manual_override: true,
    });

    await this.audit.log({
      userId,
      entity: 'customers',
      entityId: id,
      action: 'CUSTOMER_CATEGORY_SET_MANUALLY',
      oldValue: {
        category: before.category,
        manual_override: before.category_manual_override,
      },
      newValue: { category: dto.category, manual_override: true },
      reason: dto.reason,
    });

    return customer;
  }

  /** Hands a customer back to the automatic calculation (§12.1). */
  async clearCategoryOverride(id: string, userId: string): Promise<customers> {
    const before = await this.findOne(id);
    const customer = await this.repository.update(id, {
      category_manual_override: false,
    });

    await this.audit.log({
      userId,
      entity: 'customers',
      entityId: id,
      action: 'CUSTOMER_CATEGORY_OVERRIDE_CLEARED',
      oldValue: { manual_override: before.category_manual_override },
      newValue: { manual_override: false },
    });

    return customer;
  }

  /** Used by the automatic recalculation; never sets the override flag. */
  async applyCalculatedCategory(
    id: string,
    category: customer_category,
    turnover: Prisma.Decimal,
    windowMonths: number,
  ): Promise<customers | null> {
    const before = await this.findOne(id);
    if (before.category_manual_override || before.category === category) {
      return null;
    }

    const customer = await this.repository.update(id, { category });

    await this.audit.log({
      userId: null,
      entity: 'customers',
      entityId: id,
      action: 'CUSTOMER_CATEGORY_RECALCULATED',
      oldValue: { category: before.category },
      newValue: {
        category,
        turnover_kgs: turnover.toFixed(2),
        window_months: windowMonths,
      },
    });

    return customer;
  }

  turnoverSince(customerId: string, since: Date, db: Db = this.prisma) {
    return this.repository.turnoverSince(db, customerId, since);
  }

  forCategoryRecalculation() {
    return this.repository.forCategoryRecalculation();
  }

  countManualOverrides() {
    return this.repository.countManualOverrides();
  }

  /**
   * Refuses one of the things Walk-in may not have (§11.1.2).
   *
   * Written once so every refusal reads the same and points at the same rule:
   * the fix is always to register the customer (§11.1.5).
   */
  walkInRefusal(what: WalkInForbidden): ConflictException {
    return new ConflictException(
      `Walk-in кардарга ${WALK_IN_FORBIDDEN[what]} колдонулбайт (§11.1.2). ` +
        'Керек болсо кардарды өзүнчө каттаңыз (§11.1.5).',
    );
  }

  /** Throws when the customer is Walk-in; a no-op otherwise. */
  assertNotWalkIn(customer: customers, what: WalkInForbidden): void {
    if (customer.is_walk_in) {
      throw this.walkInRefusal(what);
    }
  }
}
