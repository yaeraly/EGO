import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, customer_category } from '@prisma/client';
import { BUSINESS_TIMEZONE } from '../documents/document-number';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import {
  CategoryThreshold,
  categoryFor,
  windowStart,
} from './category-calculation';
import { CustomersService } from './customers.service';

export interface CategoryRunResult {
  window_months: number;
  window_from: string;
  considered: number;
  changed: {
    customer_id: string;
    name: string;
    from: customer_category;
    to: customer_category;
    turnover_kgs: string;
  }[];
  skipped_manual: number;
}

/**
 * The monthly category recalculation (§12.1).
 *
 * Turnover over a rolling window decides the category, and it can go down as
 * well as up — §12.1 says so explicitly, and a customer who stopped buying
 * should stop getting the discount that came with buying. A customer the
 * OWNER has categorised by hand is left alone entirely.
 */
@Injectable()
export class CategoryJobService {
  private readonly logger = new Logger(CategoryJobService.name);

  constructor(
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
  ) {}

  /** 02:00 Bishkek on the first of each month, when nobody is selling. */
  @Cron('0 2 1 * *', {
    name: 'customer-category-recalculation',
    timeZone: BUSINESS_TIMEZONE,
  })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run();
      this.logger.log(
        `Category recalculation: ${result.changed.length} of ${result.considered} changed`,
      );
    } catch (error) {
      this.logger.error('Category recalculation failed', error as Error);
    }
  }

  async run(now: Date = new Date()): Promise<CategoryRunResult> {
    const months = (
      await this.settings.optionalDecimal(SettingKey.CATEGORY_WINDOW_MONTHS)
    )?.toNumber() ?? 12;
    const from = windowStart(months, now);
    const thresholds = await this.thresholds();

    const customers = await this.customers.forCategoryRecalculation();
    const changed: CategoryRunResult['changed'] = [];

    for (const customer of customers) {
      const turnover = await this.customers.turnoverSince(customer.id, from);
      const earned = categoryFor(turnover, thresholds);

      const updated = await this.customers.applyCalculatedCategory(
        customer.id,
        earned,
        turnover,
        months,
      );
      if (updated) {
        changed.push({
          customer_id: customer.id,
          name: customer.name,
          from: customer.category,
          to: earned,
          turnover_kgs: turnover.toFixed(2),
        });
      }
    }

    return {
      window_months: months,
      window_from: from.toISOString().slice(0, 10),
      considered: customers.length,
      changed,
      // Counted for the report; `forCategoryRecalculation` already excludes
      // them, so they were never at risk of being changed.
      skipped_manual: await this.customers.countManualOverrides(),
    };
  }

  /**
   * The configured bands (§12).
   *
   * A threshold left unset is left out — GOLD and VIP are "кийин такталат" in
   * §12, and inventing a boundary would silently promote customers into a
   * band nobody has priced.
   */
  private async thresholds(): Promise<CategoryThreshold[]> {
    const configured: [customer_category, string][] = [
      [customer_category.SILVER, SettingKey.CATEGORY_SILVER_THRESHOLD_KGS],
      [customer_category.GOLD, SettingKey.CATEGORY_GOLD_THRESHOLD_KGS],
      [customer_category.VIP, SettingKey.CATEGORY_VIP_THRESHOLD_KGS],
    ];

    const thresholds: CategoryThreshold[] = [
      { category: customer_category.STANDARD, from: new Prisma.Decimal(0) },
    ];

    for (const [category, key] of configured) {
      const value = await this.settings.optionalDecimal(key as never);
      if (value !== null) {
        thresholds.push({ category, from: value });
      }
    }

    return thresholds;
  }
}
