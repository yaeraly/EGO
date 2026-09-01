import { Controller, Get, Query } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  currentBusinessDate,
  parseBusinessDate,
} from '../documents/business-date';
import {
  AnalyticsService,
  ProductAnalysisReport,
  ReorderReport,
  SalesTrendReport,
} from './analytics.service';
import {
  BalanceReport,
  CashFlowReport,
  ProfitAndLossReport,
  ReportsService,
} from './reports.service';

/** Defaults to the current month, which is what a report is usually wanted for. */
function period(from?: string, to?: string): { from: Date; to: Date } {
  const today = currentBusinessDate();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  return {
    from: from ? parseBusinessDate(from) : start,
    to: to ? parseBusinessDate(to) : today,
  };
}

/**
 * The financial statements (§28).
 *
 * OWNER-only: §2 gives the whole financial picture to the owner. A
 * salesperson's own day and their own sales are theirs to see, and those live
 * on their own screens.
 */
@Roles(user_role.OWNER)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** ДДС — Cash Flow. */
  @Get('cash-flow')
  cashFlow(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CashFlowReport> {
    return this.reports.cashFlow(period(from, to));
  }

  /** ОПУ — Profit and Loss. */
  @Get('profit-loss')
  profitAndLoss(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ProfitAndLossReport> {
    return this.reports.profitAndLoss(period(from, to));
  }

  /** Баланс — the position now (§28). */
  @Get('balance')
  balance(): Promise<BalanceReport> {
    return this.reports.balance();
  }

  /**
   * ABC, XYZ, margin and sales by product — one table (§29).
   *
   * They are one query and one screen because they are read together: what a
   * product earns, how steady it is, and what it leaves behind.
   */
  @Get('products')
  products(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ProductAnalysisReport> {
    return this.analytics.products(period(from, to));
  }

  /** Daily, weekly or monthly sales (§29). */
  @Get('sales-trend')
  salesTrend(
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<SalesTrendReport> {
    const unit =
      bucket === 'day' || bucket === 'week' || bucket === 'month'
        ? bucket
        : 'day';
    return this.analytics.salesTrend(period(from, to), unit);
  }

  /** What needs ordering (§29, §12-Б.4). */
  @Get('reorder')
  reorder(@Query('window_days') windowDays?: string): Promise<ReorderReport> {
    const days = Number(windowDays);
    return this.analytics.reorder(
      Number.isFinite(days) && days > 0 && days <= 365 ? Math.trunc(days) : 30,
    );
  }
}
