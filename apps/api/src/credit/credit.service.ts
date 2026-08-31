import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, customers, user_role } from '@prisma/client';
import { Db } from '../common/db';
import { CustomersService } from '../customers/customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { CreditRepository, OpenSaleDebt } from './credit.repository';

const ZERO = new Prisma.Decimal(0);

/** Everything §16.6 says the sale screen shows when a customer is chosen. */
export interface CreditStanding {
  customer_id: string;
  ctype: string;
  category: string;
  is_walk_in: boolean;
  /** Individual limit if set, otherwise the category default (§16.1). */
  effective_credit_limit: string | null;
  limit_source: 'INDIVIDUAL' | 'CATEGORY' | 'UNCONFIGURED';
  current_open_debt: string;
  overdue_amount: string;
  /** max(0, limit − open debt); zero while anything is overdue (§16.6). */
  available_credit: string;
  has_overdue: boolean;
  oldest_unpaid_due_date: string | null;
  open_debts: {
    sale_id: string;
    doc_number: string;
    business_date: string;
    outstanding: string;
    due_date: string | null;
    is_overdue: boolean;
  }[];
}

/** The answer to "may this sale leave a debt behind?" (§16.2, §16.4). */
export interface CreditDecision {
  allowed: boolean;
  reason: 'OK' | 'WALK_IN' | 'OVERDUE' | 'LIMIT_EXCEEDED' | 'NO_LIMIT';
  message: string | null;
  current_open_debt: Prisma.Decimal;
  overdue_amount: Prisma.Decimal;
  effective_credit_limit: Prisma.Decimal | null;
  new_debt: Prisma.Decimal;
  projected_debt: Prisma.Decimal;
  /** How much must be paid now for the sale to go through (§16.3). */
  must_pay_now: Prisma.Decimal;
}

/**
 * Credit control (§16.1–16.7).
 *
 * A sale that leaves nothing owed is never touched by any of this — §16.7 is
 * explicit that the block applies to credit, not to paying customers. What is
 * checked is the debt a sale would *create*: not its total, but the part the
 * customer is not paying now (§16.2).
 */
@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CreditRepository,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
  ) {}

  /** What §16.6 puts on the screen. */
  async standing(
    customerId: string,
    db: Db = this.prisma,
    today: Date = startOfToday(),
  ): Promise<CreditStanding> {
    const customer = await this.customers.findOne(customerId, db);
    const debts = await this.repository.openDebts(db, customerId);
    const limit = await this.effectiveLimit(customer);

    const openDebt = sum(debts.map((d) => d.outstanding_amount));
    const overdue = sum(
      debts
        .filter((d) => isOverdue(d, today))
        .map((d) => d.outstanding_amount),
    );

    const hasOverdue = overdue.greaterThan(0);
    const available = hasOverdue
      ? ZERO
      : limit.value
        ? Prisma.Decimal.max(limit.value.minus(openDebt), ZERO)
        : ZERO;

    const oldestDue = debts
      .filter((d) => d.debt_due_date !== null)
      .sort((a, b) => a.debt_due_date!.getTime() - b.debt_due_date!.getTime())[0];

    return {
      customer_id: customerId,
      ctype: customer.ctype,
      category: customer.category,
      is_walk_in: customer.is_walk_in,
      effective_credit_limit: limit.value?.toFixed(2) ?? null,
      limit_source: limit.source,
      current_open_debt: openDebt.toFixed(2),
      overdue_amount: overdue.toFixed(2),
      available_credit: available.toFixed(2),
      has_overdue: hasOverdue,
      oldest_unpaid_due_date:
        oldestDue?.debt_due_date?.toISOString().slice(0, 10) ?? null,
      open_debts: debts.map((debt) => ({
        sale_id: debt.sale_id,
        doc_number: debt.doc_number,
        business_date: debt.business_date.toISOString().slice(0, 10),
        outstanding: debt.outstanding_amount.toFixed(2),
        due_date: debt.debt_due_date?.toISOString().slice(0, 10) ?? null,
        is_overdue: isOverdue(debt, today),
      })),
    };
  }

  /**
   * Decides whether a sale may leave `newDebt` unpaid (§16.2–16.4).
   *
   * Called inside the confirming transaction with the customer's debts
   * already locked, so the answer cannot go stale between the check and the
   * sale it authorises.
   */
  async decide(
    tx: Prisma.TransactionClient,
    params: {
      customer: customers;
      newDebt: Prisma.Decimal;
      today?: Date;
    },
  ): Promise<CreditDecision> {
    const today = params.today ?? startOfToday();
    const debts = await this.repository.lockOpenDebts(tx, params.customer.id);

    const openDebt = sum(debts.map((d) => d.outstanding_amount));
    const overdue = sum(
      debts.filter((d) => isOverdue(d, today)).map((d) => d.outstanding_amount),
    );
    const limit = await this.effectiveLimit(params.customer);
    const projected = openDebt.plus(params.newDebt);

    const base = {
      current_open_debt: openDebt,
      overdue_amount: overdue,
      effective_credit_limit: limit.value,
      new_debt: params.newDebt,
      projected_debt: projected,
    };

    // A fully paid sale is never blocked (§16.7).
    if (params.newDebt.lessThanOrEqualTo(0)) {
      return { ...base, allowed: true, reason: 'OK', message: null, must_pay_now: ZERO };
    }

    // Walk-in has no debt at all (§11.1.2).
    if (params.customer.is_walk_in) {
      return {
        ...base,
        allowed: false,
        reason: 'WALK_IN',
        message:
          'Walk-in кардарга карызга сатуу колдонулбайт (§11.1.2). Толук төлөм ' +
          'керек, же кардарды каттаңыз (§11.1.5).',
        must_pay_now: params.newDebt,
      };
    }

    // Overdue outranks the limit: §16.4 blocks new credit outright.
    if (overdue.greaterThan(0)) {
      return {
        ...base,
        allowed: false,
        reason: 'OVERDUE',
        message:
          `Кардарда мөөнөтү өткөн ${overdue.toFixed(2)} сом карыз бар — жаңы ` +
          'карызга сатуу блокторлот (§16.4). Толук төлөнгөн сатуу мүмкүн.',
        must_pay_now: params.newDebt,
      };
    }

    if (!limit.value) {
      return {
        ...base,
        allowed: false,
        reason: 'NO_LIMIT',
        message:
          'Бул кардарга кредиттик лимит коюла элек (§16.1) — жеке лимит же ' +
          'категория боюнча демейки лимит керек.',
        must_pay_now: params.newDebt,
      };
    }

    if (projected.greaterThan(limit.value)) {
      // §16.3: the screen says how much has to be paid now, not just "no".
      const mustPay = projected.minus(limit.value);
      return {
        ...base,
        allowed: false,
        reason: 'LIMIT_EXCEEDED',
        message:
          `Лимит ${limit.value.toFixed(2)}, учурдагы карыз ${openDebt.toFixed(2)}, ` +
          `жаңы карыз ${params.newDebt.toFixed(2)} — болжолдонгон ${projected.toFixed(2)} ` +
          `лимиттен ашат. Азыр кеминде ${mustPay.toFixed(2)} сом төлөө керек (§16.3).`,
        must_pay_now: mustPay,
      };
    }

    return { ...base, allowed: true, reason: 'OK', message: null, must_pay_now: ZERO };
  }

  /**
   * The OWNER's override (§16.5).
   *
   * Everything §16.5 lists is written down, because the point of an override
   * is that someone decided to carry a risk and the business can later see
   * exactly what risk that was. A salesperson cannot reach this.
   */
  async recordOverride(
    tx: Prisma.TransactionClient,
    params: {
      decision: CreditDecision;
      customerId: string;
      saleId: string | null;
      ownerId: string;
      role: user_role;
      reason: string;
    },
  ): Promise<void> {
    if (params.role !== user_role.OWNER) {
      throw new ForbiddenException(
        'Кредиттик блокту OWNER гана override кыла алат (§16.5)',
      );
    }
    if (!params.reason?.trim()) {
      throw new ConflictException('Override үчүн себеп милдеттүү (§16.5)');
    }

    await this.repository.insertOverride(tx, {
      customerId: params.customerId,
      saleId: params.saleId,
      ownerId: params.ownerId,
      reason: params.reason.trim(),
      openDebt: params.decision.current_open_debt,
      overdueAmount: params.decision.overdue_amount,
      creditLimit: params.decision.effective_credit_limit ?? ZERO,
      newDebt: params.decision.new_debt,
      projectedDebt: params.decision.projected_debt,
    });
  }

  /**
   * The limit that applies (§16.1).
   *
   * An individual limit replaces the category default outright. With neither
   * configured there is no limit to compare against, and that is refused
   * rather than treated as unlimited — an unset limit is not permission.
   */
  async effectiveLimit(
    customer: Pick<customers, 'individual_credit_limit' | 'category'>,
  ): Promise<{ value: Prisma.Decimal | null; source: CreditStanding['limit_source'] }> {
    if (customer.individual_credit_limit !== null) {
      return { value: customer.individual_credit_limit, source: 'INDIVIDUAL' };
    }

    const defaults = await this.categoryDefaults();
    const value = defaults?.[customer.category];
    if (value === undefined || value === null) {
      return { value: null, source: 'UNCONFIGURED' };
    }
    return { value: new Prisma.Decimal(value), source: 'CATEGORY' };
  }

  private async categoryDefaults(): Promise<Record<string, number | string> | null> {
    const setting = await this.settings
      .findOne(SettingKey.CREDIT_LIMIT_DEFAULTS)
      .catch(() => null);
    if (!setting || setting.value === null || typeof setting.value !== 'object') {
      return null;
    }
    return setting.value as Record<string, number | string>;
  }

  overridesForCustomer(customerId: string) {
    return this.repository.overridesForCustomer(customerId);
  }

  overdueDebts(today: Date = startOfToday(), db: Db = this.prisma) {
    return this.repository.overdueDebts(db, today);
  }

  dueSoon(from: Date, to: Date, db: Db = this.prisma) {
    return this.repository.dueSoon(db, from, to);
  }
}

function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), ZERO);
}

/** A debt is overdue once its due date is in the past (§16.4). */
function isOverdue(debt: OpenSaleDebt, today: Date): boolean {
  return debt.debt_due_date !== null && debt.debt_due_date < today;
}

/** Midnight UTC today — debt due dates are DATE columns, not timestamps. */
export function startOfToday(now: Date = new Date()): Date {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return today;
}
