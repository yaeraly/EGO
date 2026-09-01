import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, sales_plans } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { toOptionalDecimal } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertPlanDto } from './dto/plan.dto';

export interface PlanView {
  id: string;
  period_year: number;
  period_month: number;
  user_id: string | null;
  /** Null for the business-wide plan. */
  full_name: string | null;
  revenue_target: string | null;
  margin_target: string | null;
  new_customers_target: number | null;
  comment: string | null;
}

/**
 * Plans and KPI (§24).
 *
 * "OWNER айлык/мезгилдик план коё алат: жалпы сатуу; жалпы маржа/пайда; жаңы
 * кардарлар." One plan per month per person, and one for the business as a
 * whole — the row with no person on it.
 *
 * A plan is a target, not a fact: nothing here posts a document, and changing
 * a plan changes no money. That is why it is edited in place rather than
 * corrected (§27.1 governs posted facts).
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async upsert(dto: UpsertPlanDto, userId: string): Promise<PlanView> {
    if (
      dto.revenue_target === undefined &&
      dto.margin_target === undefined &&
      dto.new_customers_target === undefined
    ) {
      throw new BadRequestException(
        'Планда кеминде бир максат болушу керек (§24)',
      );
    }

    if (dto.user_id) {
      const exists = await this.prisma.users.findUnique({
        where: { id: dto.user_id },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException('Кызматкер табылган жок');
      }
    }

    const data = {
      revenue_target: toOptionalDecimal(dto.revenue_target, 'revenue_target'),
      margin_target: toOptionalDecimal(dto.margin_target, 'margin_target'),
      new_customers_target: dto.new_customers_target ?? null,
      comment: dto.comment ?? null,
    };

    // Prisma types the compound key as non-nullable, so the business-wide
    // plan — the row with no person on it — is looked up by hand. The
    // database still refuses a second one: the unique constraint is declared
    // NULLS NOT DISTINCT.
    const previous = await this.find(
      dto.period_year,
      dto.period_month,
      dto.user_id ?? null,
    );

    const plan = previous
      ? await this.prisma.sales_plans.update({
          where: { id: previous.id },
          data: { ...data, updated_at: new Date() },
          include: { users_sales_plans_user_idTousers: true },
        })
      : await this.prisma.sales_plans.create({
          data: {
            period_year: dto.period_year,
            period_month: dto.period_month,
            user_id: dto.user_id ?? null,
            created_by: userId,
            ...data,
          },
          include: { users_sales_plans_user_idTousers: true },
        });

    await this.audit.log({
      userId,
      entity: 'sales_plans',
      entityId: plan.id,
      action: previous ? 'PLAN_UPDATED' : 'PLAN_SET',
      oldValue: previous ? this.snapshot(previous) : undefined,
      newValue: this.snapshot(plan),
      reason: dto.comment ?? null,
    });

    return this.toView(plan);
  }

  async findMany(filter: {
    year?: number;
    month?: number;
  }): Promise<PlanView[]> {
    const plans = await this.prisma.sales_plans.findMany({
      where: {
        period_year: filter.year,
        period_month: filter.month,
      },
      include: { users_sales_plans_user_idTousers: true },
      orderBy: [
        { period_year: 'desc' },
        { period_month: 'desc' },
        { user_id: 'asc' },
      ],
    });
    return plans.map((plan) => this.toView(plan));
  }

  async remove(id: string, userId: string): Promise<void> {
    const plan = await this.prisma.sales_plans.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('План табылган жок');
    }
    await this.prisma.sales_plans.delete({ where: { id } });
    await this.audit.log({
      userId,
      entity: 'sales_plans',
      entityId: id,
      action: 'PLAN_REMOVED',
      oldValue: this.snapshot(plan),
    });
  }

  /** The plan in force for one person, or for the business, in a month. */
  find(
    year: number,
    month: number,
    userId: string | null,
  ): Promise<sales_plans | null> {
    return this.prisma.sales_plans.findFirst({
      where: { period_year: year, period_month: month, user_id: userId },
    });
  }

  private snapshot(plan: sales_plans): Prisma.InputJsonValue {
    return {
      period: `${plan.period_year}-${String(plan.period_month).padStart(2, '0')}`,
      user_id: plan.user_id,
      revenue_target: plan.revenue_target?.toFixed(2) ?? null,
      margin_target: plan.margin_target?.toFixed(2) ?? null,
      new_customers_target: plan.new_customers_target,
    };
  }

  private toView(
    plan: sales_plans & { users_sales_plans_user_idTousers?: { full_name: string } | null },
  ): PlanView {
    return {
      id: plan.id,
      period_year: plan.period_year,
      period_month: plan.period_month,
      user_id: plan.user_id,
      full_name: plan.users_sales_plans_user_idTousers?.full_name ?? null,
      revenue_target: plan.revenue_target?.toFixed(2) ?? null,
      margin_target: plan.margin_target?.toFixed(2) ?? null,
      new_customers_target: plan.new_customers_target,
      comment: plan.comment,
    };
  }
}
