import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

/** Money in a report is a string with two places, like everywhere else. */
export function money(value: Prisma.Decimal | null | undefined): string {
  return (value ?? ZERO).toFixed(2);
}

export function sum(...values: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (total, value) => total.plus(value ?? ZERO),
    ZERO,
  );
}

export interface ProfitAndLossParts {
  /** Confirmed sales in the period, at their sale price (§13). */
  revenue: Prisma.Decimal;
  /** What came back (§35), at the price it was sold for. */
  returns: Prisma.Decimal;
  /** The FIFO cost of everything sold (§13.3, §18). */
  cogs: Prisma.Decimal;
  /** The FIFO cost of what came back — it is stock again, not a cost (§18.0). */
  returnedCost: Prisma.Decimal;
  /** Rent, internet, salaries, bonuses (§25, §26, §23). */
  operatingExpenses: Prisma.Decimal;
  /** Scrap money and the like (§38.7). */
  otherIncome: Prisma.Decimal;
  /** What was written off the books as unsellable (§38). */
  writeOffs: Prisma.Decimal;
  /**
   * A stock count's own result (§22): what was missing, less what was found.
   *
   * §22 puts the shortage in a line of its own and keeps it out of the bonus
   * base, so it belongs here rather than folded into the cost of goods sold.
   */
  inventoryResult: Prisma.Decimal;
  /** Realised exchange difference — its own line, never a trading result (§10, §42.8). */
  fxGainLoss: Prisma.Decimal;
}

export interface ProfitAndLoss {
  revenue: string;
  returns: string;
  net_revenue: string;
  cogs: string;
  returned_cost: string;
  net_cogs: string;
  gross_margin: string;
  operating_expenses: string;
  other_income: string;
  write_offs: string;
  inventory_result: string;
  operating_profit: string;
  fx_gain_loss: string;
  net_profit: string;
}

/**
 * Profit and Loss (§28).
 *
 * Two things are deliberately absent, and §3.1.5 says so in as many words:
 * an owner's withdrawal and a return of capital are not expenses and never
 * reduce this profit. They leave the business through the Cash Flow and the
 * Balance instead.
 *
 * The exchange difference sits below the operating result because §42.8 makes
 * it a financial gain or loss of its own — it is not something the shop floor
 * earned, which is also why it stays out of the bonus (§23.5).
 */
export function profitAndLoss(parts: ProfitAndLossParts): ProfitAndLoss {
  const netRevenue = parts.revenue.minus(parts.returns);
  const netCogs = parts.cogs.minus(parts.returnedCost);
  const grossMargin = netRevenue.minus(netCogs);
  const operatingProfit = grossMargin
    .minus(parts.operatingExpenses)
    .plus(parts.otherIncome)
    .minus(parts.writeOffs)
    .minus(parts.inventoryResult);
  const netProfit = operatingProfit.plus(parts.fxGainLoss);

  return {
    revenue: money(parts.revenue),
    returns: money(parts.returns),
    net_revenue: money(netRevenue),
    cogs: money(parts.cogs),
    returned_cost: money(parts.returnedCost),
    net_cogs: money(netCogs),
    gross_margin: money(grossMargin),
    operating_expenses: money(parts.operatingExpenses),
    other_income: money(parts.otherIncome),
    write_offs: money(parts.writeOffs),
    inventory_result: money(parts.inventoryResult),
    operating_profit: money(operatingProfit),
    fx_gain_loss: money(parts.fxGainLoss),
    net_profit: money(netProfit),
  };
}

export interface BalanceParts {
  cash: Prisma.Decimal;
  inventoryMain: Prisma.Decimal;
  inventoryDefect: Prisma.Decimal;
  customerReceivables: Prisma.Decimal;
  /** Shipped but not yet received — the supplier owes us the goods (§6.1). */
  goodsInTransit: Prisma.Decimal;
  supplierReceivables: Prisma.Decimal;
  cargoReceivables: Prisma.Decimal;
  openClaims: Prisma.Decimal;
  supplierPayable: Prisma.Decimal;
  cargoPayable: Prisma.Decimal;
  customerAdvances: Prisma.Decimal;
  capitalIn: Prisma.Decimal;
  capitalOut: Prisma.Decimal;
  retainedEarnings: Prisma.Decimal;
}

export interface BalanceTotals {
  assets: string;
  liabilities: string;
  equity: string;
  /** Assets − Liabilities − Equity. Zero when the books hold together. */
  difference: string;
  balanced: boolean;
}

/**
 * The Balance's three totals, and whether they meet (§28).
 *
 * The difference is reported rather than hidden. Every figure here comes from
 * documents, so a difference means something moved without one — which is the
 * single thing §27 and §42.3 exist to prevent, and worth seeing rather than
 * rounding away.
 *
 * Customer advances are a liability of their own and never merged with what
 * customers owe (§17-А.5) — the two are opposite in direction and netting
 * them would hide both.
 *
 * Goods in transit are what keeps the two sides level between the moment the
 * supplier ships (when the debt falls due, §6.1) and the moment we receive:
 * the debt is on one side and the shipment we are owed on the other. At the
 * Receipt the shipment becomes stock and the line empties.
 */
export function balanceTotals(parts: BalanceParts): BalanceTotals {
  const assets = sum(
    parts.cash,
    parts.inventoryMain,
    parts.inventoryDefect,
    parts.customerReceivables,
    parts.goodsInTransit,
    parts.supplierReceivables,
    parts.cargoReceivables,
    parts.openClaims,
  );
  const liabilities = sum(
    parts.supplierPayable,
    parts.cargoPayable,
    parts.customerAdvances,
  );
  const equity = parts.capitalIn
    .minus(parts.capitalOut)
    .plus(parts.retainedEarnings);
  const difference = assets.minus(liabilities).minus(equity);

  return {
    assets: money(assets),
    liabilities: money(liabilities),
    equity: money(equity),
    difference: money(difference),
    balanced: difference.abs().lessThan(new Prisma.Decimal('0.01')),
  };
}
