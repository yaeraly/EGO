import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** One line as the pricing rules see it. */
export interface PricedLine {
  productId: string;
  sku: string;
  name: string;
  qty: Prisma.Decimal;
  /** What the system suggested per unit (§13). */
  autoPrice: Prisma.Decimal;
  /** What is actually being charged per unit. */
  finalPrice: Prisma.Decimal;
  /** The OWNER's floor for this product, if any (§13.2). */
  minSellingPrice: Prisma.Decimal | null;
  /** FIFO cost of exactly these units (§13.3). */
  fifoCogs: Prisma.Decimal;
  discountReason: string | null;
}

export type SaleBlockCode =
  | 'BELOW_COGS'
  | 'BELOW_MIN_PRICE'
  | 'DISCOUNT_OVER_LIMIT'
  | 'MISSING_DISCOUNT_REASON'
  | 'NEGATIVE_PRICE';

export interface SaleBlock {
  code: SaleBlockCode;
  product_id?: string;
  sku?: string;
  message: string;
  /** True when only an OWNER approval can clear it (§13.5). */
  needs_owner_approval: boolean;
}

export interface DiscountFacts {
  /** Σ auto price × qty. */
  autoTotal: Prisma.Decimal;
  /** Σ final price × qty — the revenue (§13.7). */
  finalTotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  fifoCogs: Prisma.Decimal;
  /** Revenue less cost — the margin §13.5 shows the OWNER. */
  margin: Prisma.Decimal;
  /** True when any line is priced below its suggestion. */
  hasManualDiscount: boolean;
}

/** Totals and the discount picture, for the screen and the audit (§13.8). */
export function discountFacts(lines: PricedLine[]): DiscountFacts {
  const autoTotal = lines.reduce(
    (sum, line) => sum.plus(line.autoPrice.times(line.qty)),
    ZERO,
  );
  const finalTotal = lines.reduce(
    (sum, line) => sum.plus(line.finalPrice.times(line.qty)),
    ZERO,
  );
  const fifoCogs = lines.reduce((sum, line) => sum.plus(line.fifoCogs), ZERO);
  const discountAmount = autoTotal.minus(finalTotal);

  return {
    autoTotal,
    finalTotal,
    discountAmount,
    discountPct: autoTotal.greaterThan(0)
      ? discountAmount.times(HUNDRED).dividedBy(autoTotal).toDecimalPlaces(2)
      : ZERO,
    fifoCogs,
    margin: finalTotal.minus(fifoCogs),
    hasManualDiscount: lines.some((line) =>
      line.finalPrice.lessThan(line.autoPrice),
    ),
  };
}

/**
 * Every reason an ordinary sale cannot be confirmed (§13.1–13.5).
 *
 * Checked in the order §13.1 lists, and returned all together so the screen
 * can show the whole picture rather than one problem at a time. Whether a
 * block can be cleared by an approval is part of the answer: a discount over
 * someone's limit can (§13.5), a price below cost cannot (§13.4).
 *
 * Pure — this decides whether money changes hands, and is worth testing on
 * its own.
 */
export function saleBlocks(params: {
  lines: PricedLine[];
  /** The salesperson's own discount ceiling, in percent (§13.1). */
  maxDiscountPct: Prisma.Decimal;
  /** True once an OWNER has approved the discount (§13.5). */
  discountApproved: boolean;
  /** Loss sales are a different document with different rules (§13.6). */
  isLossSale: boolean;
}): SaleBlock[] {
  const blocks: SaleBlock[] = [];

  for (const line of params.lines) {
    if (line.finalPrice.isNegative()) {
      blocks.push({
        code: 'NEGATIVE_PRICE',
        product_id: line.productId,
        sku: line.sku,
        message: `«${line.sku}»: баа терс боло албайт`,
        needs_owner_approval: false,
      });
      continue;
    }

    const discounted = line.finalPrice.lessThan(line.autoPrice);

    // §13.8 wants the reason on record; without it the discount is not
    // explainable later, so it is refused now.
    if (discounted && !line.discountReason?.trim()) {
      blocks.push({
        code: 'MISSING_DISCOUNT_REASON',
        product_id: line.productId,
        sku: line.sku,
        message: `«${line.sku}»: скидканын себеби көрсөтүлүшү керек (§13.8)`,
        needs_owner_approval: false,
      });
    }

    // §13.2 — the OWNER's own floor, which a loss sale is exempt from
    // because it is precisely a deliberate sale below the usual floor.
    if (
      !params.isLossSale &&
      line.minSellingPrice &&
      line.finalPrice.lessThan(line.minSellingPrice)
    ) {
      blocks.push({
        code: 'BELOW_MIN_PRICE',
        product_id: line.productId,
        sku: line.sku,
        message:
          `«${line.sku}»: ${line.finalPrice.toFixed(2)} баасы минималдуу сатуу ` +
          `баасынан (${line.minSellingPrice.toFixed(2)}) төмөн (§13.2)`,
        needs_owner_approval: false,
      });
    }
  }

  const facts = discountFacts(params.lines);

  // §13.1, §13.5 — a discount beyond the salesperson's own ceiling needs the
  // OWNER, who sees the price, the discount, the cost and the margin.
  if (
    facts.hasManualDiscount &&
    !params.discountApproved &&
    facts.discountPct.greaterThan(params.maxDiscountPct)
  ) {
    blocks.push({
      code: 'DISCOUNT_OVER_LIMIT',
      message:
        `Скидка ${facts.discountPct.toFixed(2)}% — кызматкердин лимити ` +
        `${params.maxDiscountPct.toFixed(2)}%. OWNER бекитиши керек (§13.5).`,
      needs_owner_approval: true,
    });
  }

  // §13.4 — the absolute one. Not the salesperson, not the manager, not the
  // OWNER: an ordinary sale below FIFO cost is refused outright, and the
  // message says what to do instead.
  if (!params.isLossSale && facts.finalTotal.lessThan(facts.fifoCogs)) {
    blocks.push({
      code: 'BELOW_COGS',
      message:
        'Өздүк нарктан төмөн сатуу кадимки сатууда мүмкүн эмес. ' +
        'Зарыл болсо LSS процессин колдонуңуз (§13.4, §13.6).',
      needs_owner_approval: false,
    });
  }

  return blocks;
}

/** Loss = COGS − Final Selling Price, when the price is below cost (§13.6). */
export function lossAmount(facts: DiscountFacts): Prisma.Decimal {
  return Prisma.Decimal.max(facts.fifoCogs.minus(facts.finalTotal), ZERO);
}
