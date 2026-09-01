import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreditService } from '../credit/credit.service';
import { currentBusinessDate } from '../documents/business-date';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { AnalyticsService } from './analytics.service';
import {
  HealthItem,
  Severity,
  behindPlan,
  bySeverity,
  claimSeverity,
  deadStockSeverity,
  monthProgressPct,
} from './health-rules';
import { HealthRepository } from './health.repository';
import { PerformanceService } from './performance.service';
import { PurchaseAdviceService } from './purchase-advice.service';
import { money } from './report-math';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

const ZERO = new Prisma.Decimal(0);

export interface HealthReport {
  as_of: string;
  /** How far into the month the business is — what "behind" is measured against. */
  month_progress_pct: string;
  counts: { urgent: number; warning: number; info: number };
  items: HealthItem[];
}

/**
 * The business health board (§34).
 *
 * §34 ends on the point of the whole section: "система жөн гана эсеп
 * жүргүзбөстөн, OWNER'ге эмне кылуу керектигин көрсөтүп турушу". So this is
 * a list of things to do, not a list of things that are true — every item
 * says what to do about it and where.
 *
 * It is read on demand and raises no notifications: §39's alerts are a
 * separate thing that pushes, and two systems shouting the same sentence
 * would teach the OWNER to ignore both.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly reportsRepository: ReportsRepository,
    private readonly reports: ReportsService,
    private readonly analytics: AnalyticsService,
    private readonly advice: PurchaseAdviceService,
    private readonly performance: PerformanceService,
    private readonly credit: CreditService,
    private readonly settings: SettingsService,
  ) {}

  async load(): Promise<HealthReport> {
    const today = currentBusinessDate();
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const progress = monthProgressPct(today);

    const [deadDays, claimDays, deadUrgent] = await Promise.all([
      this.settings.optionalDecimal(SettingKey.HEALTH_DEAD_STOCK_DAYS),
      this.settings.optionalDecimal(SettingKey.HEALTH_CLAIM_STALE_DAYS),
      this.settings.optionalDecimal(SettingKey.HEALTH_DEAD_STOCK_URGENT_KGS),
    ]);
    const deadStockDays = deadDays?.round().toNumber() ?? 90;
    const claimStaleDays = claimDays?.round().toNumber() ?? 30;
    const deadStockUrgent = deadUrgent ?? new Prisma.Decimal(50000);

    const deadSince = new Date(today);
    deadSince.setUTCDate(deadSince.getUTCDate() - deadStockDays);
    const recently = new Date(today);
    recently.setUTCDate(recently.getUTCDate() - 30);

    const [
      advice,
      overdue,
      dueSoon,
      suppliers,
      cargo,
      claims,
      deadStock,
      profitable,
      sellers,
      cashDiffs,
      inventoryDiffs,
      balance,
    ] = await Promise.all([
      this.advice.advise(),
      this.credit.overdueDebts(),
      this.credit.dueSoon(today, dueWithin(today, 7)),
      this.reportsRepository.supplierBalances(),
      this.reportsRepository.cargoBalances(),
      this.repository.openClaims(),
      this.repository.deadStock(deadSince),
      this.analytics.products({ from: monthStart, to: today }),
      this.performance.sellers({ from: monthStart, to: today }),
      this.repository.cashDifferences(recently),
      this.repository.inventoryDifferences(recently),
      this.reports.balance(),
    ]);

    const items: HealthItem[] = [];

    // 1. What is running out, and what to order (§33, §34).
    const urgentOrders = advice.order.filter((row) => row.priority === 'URGENT');
    if (urgentOrders.length > 0) {
      items.push({
        kind: 'ORDER_URGENT',
        severity: 'URGENT',
        title: `${urgentOrders.length} товар түгөнүп калат`,
        detail:
          `Жаңы заказ келгенге чейин түгөнөт: ` +
          `${urgentOrders.slice(0, 3).map((row) => row.name).join(', ')}` +
          `${urgentOrders.length > 3 ? ' ж.б.' : ''}. Заказ кылуу керек.`,
        link: '/purchase-advice',
        amount: advice.budget.estimated_cny,
        currency: 'CNY',
        count: urgentOrders.length,
      });
    }
    if (new Prisma.Decimal(advice.budget.shortfall_cny).greaterThan(ZERO)) {
      items.push({
        kind: 'CNY_SHORTFALL',
        severity: 'WARNING',
        title: 'Заказды төлөөгө юань жетишпейт',
        detail:
          `Сунушталган заказ ${advice.budget.estimated_cny} CNY, кассада ` +
          `${advice.budget.available_cny} CNY бар. Валюта сатып алуу (CEX) керек.`,
        link: '/currency-exchange',
        amount: advice.budget.shortfall_cny,
        currency: 'CNY',
        count: 1,
      });
    }

    // 2. Who owes money, and who is about to (§16.4, §34).
    if (overdue.length > 0) {
      const total = overdue.reduce<Prisma.Decimal>(
        (sum, sale) => sum.plus(sale.outstanding_amount),
        ZERO,
      );
      items.push({
        kind: 'DEBT_OVERDUE',
        severity: 'URGENT',
        title: `${overdue.length} карыздын мөөнөтү өтүп кетти`,
        detail:
          `Акча өндүрүү керек: ` +
          `${[...new Set(overdue.map((sale) => sale.customers.name))].slice(0, 3).join(', ')}` +
          `${overdue.length > 3 ? ' ж.б.' : ''}`,
        link: '/customers',
        amount: money(total),
        currency: 'KGS',
        count: overdue.length,
      });
    }
    if (dueSoon.length > 0) {
      const total = dueSoon.reduce<Prisma.Decimal>(
        (sum, sale) => sum.plus(sale.outstanding_amount),
        ZERO,
      );
      items.push({
        kind: 'DEBT_DUE_SOON',
        severity: 'WARNING',
        title: `${dueSoon.length} карыздын мөөнөтү жакындады`,
        detail: 'Жети күндүн ичинде төлөнүшү керек — эскертип коюңуз.',
        link: '/customers',
        amount: money(total),
        currency: 'KGS',
        count: dueSoon.length,
      });
    }

    // 3. What the business owes (§4, §5.2, §34).
    const supplierOwed = suppliers.filter((row) => row.kgs.isNegative());
    if (supplierOwed.length > 0) {
      items.push({
        kind: 'SUPPLIER_DEBT',
        severity: 'INFO',
        title: 'Поставщикке карыз бар',
        detail: supplierOwed
          .map((row) => `${row.name}: ${row.balance_cny.abs().toFixed(2)} CNY`)
          .join(' · '),
        link: '/suppliers',
        amount: money(
          supplierOwed.reduce<Prisma.Decimal>(
            (sum, row) => sum.plus(row.kgs.abs()),
            ZERO,
          ),
        ),
        currency: 'KGS',
        count: supplierOwed.length,
      });
    }
    const cargoOwed = cargo.filter((row) => row.kgs.isNegative());
    if (cargoOwed.length > 0) {
      items.push({
        kind: 'CARGO_DEBT',
        severity: 'INFO',
        title: 'Каргого карыз бар',
        detail: cargoOwed
          .map((row) => `${row.name}: ${row.balance_usd.abs().toFixed(2)} USD`)
          .join(' · '),
        link: '/cargo',
        amount: money(
          cargoOwed.reduce<Prisma.Decimal>(
            (sum, row) => sum.plus(row.kgs.abs()),
            ZERO,
          ),
        ),
        currency: 'KGS',
        count: cargoOwed.length,
      });
    }

    // 4. Claims standing too long (§8.5, §34).
    for (const claim of claims) {
      const severity = claimSeverity(Number(claim.age_days), claimStaleDays);
      if (severity === 'INFO') {
        continue;
      }
      items.push({
        kind: 'CLAIM_STALE',
        severity,
        title: `${claim.doc_number} — ${claim.age_days} күн ачык турат`,
        detail:
          `${claim.counterparty ?? 'Контрагент'} боюнча талап чечилген жок. ` +
          'Компенсация, акча кайтаруу же списание керек (§8.5).',
        link: '/claims',
        amount: claim.amount.toFixed(2),
        currency: claim.currency,
        count: 1,
      });
    }

    // 5. Money standing still on the shelf (§34).
    for (const product of deadStock.slice(0, 5)) {
      items.push({
        kind: 'DEAD_STOCK',
        severity: deadStockSeverity(product.value, deadStockUrgent),
        title: `${product.name} — акча складда турат`,
        detail:
          `${product.qty.toFixed(2)} даана, ${money(product.value)} сом. ` +
          (product.last_sold
            ? `Акыркы сатуу: ${product.last_sold.toISOString().slice(0, 10)}.`
            : 'Бир да жолу сатылган эмес.') +
          ' Баасын кароо же акция керек.',
        link: `/products/${product.product_id}`,
        amount: money(product.value),
        currency: 'KGS',
        count: 1,
      });
    }

    // 6. What earns most — the one item that is good news (§34).
    const best = profitable.products
      .slice()
      .sort((a, b) =>
        new Prisma.Decimal(b.margin).comparedTo(new Prisma.Decimal(a.margin)),
      )
      .slice(0, 3);
    if (best.length > 0 && new Prisma.Decimal(best[0].margin).greaterThan(ZERO)) {
      items.push({
        kind: 'TOP_MARGIN',
        severity: 'INFO',
        title: 'Эң көп пайда берген товарлар',
        detail:
          best
            .map((row) => `${row.name} (${row.margin} сом)`)
            .join(' · ') + ' — запасын үзгүлтүксүз кармаган оң.',
        link: '/analytics',
        amount: best[0].margin,
        currency: 'KGS',
        count: best.length,
      });
    }

    // 7. Who is behind their plan (§24, §34).
    for (const seller of sellers.sellers) {
      const verdict = behindPlan({
        achievementPct: seller.achievement.revenue_pct,
        monthProgressPct: progress,
      });
      if (!verdict?.behind) {
        continue;
      }
      items.push({
        kind: 'SELLER_BEHIND_PLAN',
        severity: 'WARNING',
        title: `${seller.full_name} планынан артта`,
        detail:
          `Ай ${progress.toDecimalPlaces(0).toFixed(0)}% өттү, план ` +
          `${seller.achievement.revenue_pct}% аткарылды — ${verdict.gapPct} пункт артта.`,
        link: '/performance',
        amount: seller.revenue,
        currency: 'KGS',
        count: 1,
      });
    }

    // 8. Where the books and the world disagreed (§20, §22, §27, §34).
    if (!balance.balanced) {
      items.push({
        kind: 'BALANCE_DIFFERENCE',
        severity: 'URGENT',
        title: 'Баланс чогулбай жатат',
        detail:
          `Актив − Пассив − Капитал = ${balance.difference} сом. ` +
          'Документсиз кыймыл болгонун билдирет (§27, §42.3).',
        link: '/reports',
        amount: balance.difference,
        currency: 'KGS',
        count: 1,
      });
    }
    if (cashDiffs.length > 0) {
      const total = cashDiffs.reduce<Prisma.Decimal>(
        (sum, row) => sum.plus(row.difference.abs()),
        ZERO,
      );
      items.push({
        kind: 'CASH_DIFFERENCE',
        severity: 'WARNING',
        title: `${cashDiffs.length} касса тапшырууда айырма чыккан`,
        detail: cashDiffs
          .slice(0, 3)
          .map(
            (row) =>
              `${row.full_name} ${row.business_date.toISOString().slice(0, 10)}: ${row.difference.toFixed(2)}`,
          )
          .join(' · '),
        link: '/day-close',
        amount: money(total),
        currency: 'KGS',
        count: cashDiffs.length,
      });
    }
    if (inventoryDiffs.length > 0) {
      items.push({
        kind: 'INVENTORY_DIFFERENCE',
        severity: 'WARNING',
        title: `${inventoryDiffs.length} инвентаризацияда айырма чыккан`,
        detail: inventoryDiffs
          .slice(0, 3)
          .map(
            (row) =>
              `${row.doc_number} (${row.business_date.toISOString().slice(0, 10)}): ${money(row.value)} сом`,
          )
          .join(' · '),
        link: '/inventories',
        amount: money(
          inventoryDiffs.reduce<Prisma.Decimal>(
            (sum, row) => sum.plus(row.value),
            ZERO,
          ),
        ),
        currency: 'KGS',
        count: inventoryDiffs.length,
      });
    }

    items.sort(bySeverity);

    return {
      as_of: today.toISOString().slice(0, 10),
      month_progress_pct: progress
        .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(1),
      counts: {
        urgent: count(items, 'URGENT'),
        warning: count(items, 'WARNING'),
        info: count(items, 'INFO'),
      },
      items,
    };
  }
}

function count(items: HealthItem[], severity: Severity): number {
  return items.filter((item) => item.severity === severity).length;
}

function dueWithin(today: Date, days: number): Date {
  const until = new Date(today);
  until.setUTCDate(until.getUTCDate() + days);
  return until;
}
