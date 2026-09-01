import { Controller, Get, Query } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  currentBusinessDate,
  parseBusinessDate,
} from '../documents/business-date';
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
  constructor(private readonly reports: ReportsService) {}

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
}
