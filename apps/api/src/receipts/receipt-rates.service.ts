import { Injectable } from '@nestjs/common';
import { Prisma, currency_code, rate_source } from '@prisma/client';
import { Db } from '../common/db';
import { roundRate } from '../common/decimal';
import { ReferenceRateService } from '../currency/reference-rate.service';
import { PrismaService } from '../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

export interface RateSuggestion {
  rate: Prisma.Decimal;
  source: rate_source;
  /** How the figure was arrived at, for the screen and the audit log. */
  paid_amount: string;
  paid_rate: string | null;
  unpaid_amount: string;
  unpaid_rate: string | null;
}

/**
 * The exchange rate a receipt values goods at (§10.1).
 *
 * §10.1 sets the rate per *portion*, not per document: yuan already paid for
 * are worth what they actually cost (§10-А FIFO), and yuan still owed are
 * carried at the last real purchase rate. An order is often part-paid, so the
 * rate stored on the receipt is the exact weighted average of the two — the
 * KGS value it produces is precisely
 *
 *     paid_cny × factual_rate + unpaid_cny × reference_rate
 *
 * which is what §10.1 asks for, expressed as one number because that is what
 * the LOT records (§18.1.1).
 *
 * The source follows the part still exposed to rate movement: FACTUAL only
 * when every yuan has been paid for, otherwise REFERENCE, because the unpaid
 * part is what makes the figure provisional. MANUAL is set when the OWNER
 * overrides the suggestion.
 */
@Injectable()
export class ReceiptRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceRate: ReferenceRateService,
  ) {}

  /**
   * The CNY rate to value one purchase's goods at.
   *
   * The factual side comes from the payments actually made against this
   * purchase: their recorded KGS value divided by the yuan they moved, which
   * is exactly the FIFO layers those yuan came off.
   */
  async suggestForPurchase(
    purchaseId: string,
    totalCny: Prisma.Decimal,
    db: Db = this.prisma,
  ): Promise<RateSuggestion> {
    const reference = await this.referenceRate.forCurrency(currency_code.CNY);

    const [paid] = await db.$queryRaw<
      { amount_cny: Prisma.Decimal | null; kgs_value: Prisma.Decimal | null }[]
    >`
      SELECT COALESCE(SUM(p.amount_cny), 0) AS amount_cny,
             COALESCE(SUM(p.kgs_value), 0) AS kgs_value
      FROM supplier_payments p
      JOIN documents d ON d.id = p.document_id
      WHERE p.purchase_id = ${purchaseId}::uuid AND d.status = 'CONFIRMED'
    `;

    // A payment beyond the order total is an advance (§4.3); only what this
    // order's goods were actually paid for counts towards their rate.
    const paidCny = Prisma.Decimal.min(paid.amount_cny ?? ZERO, totalCny);
    const paidKgsFull = paid.kgs_value ?? ZERO;
    const factualRate = (paid.amount_cny ?? ZERO).greaterThan(0)
      ? roundRate(paidKgsFull.dividedBy(paid.amount_cny!))
      : null;

    const unpaidCny = totalCny.minus(paidCny);

    if (totalCny.lessThanOrEqualTo(0) || factualRate === null) {
      return {
        rate: reference.rate,
        source: rate_source.REFERENCE,
        paid_amount: ZERO.toFixed(2),
        paid_rate: null,
        unpaid_amount: totalCny.toFixed(2),
        unpaid_rate: reference.rate.toString(),
      };
    }

    const blended = roundRate(
      paidCny
        .times(factualRate)
        .plus(unpaidCny.times(reference.rate))
        .dividedBy(totalCny),
    );

    return {
      rate: blended,
      source: unpaidCny.isZero() ? rate_source.FACTUAL : rate_source.REFERENCE,
      paid_amount: paidCny.toFixed(2),
      paid_rate: factualRate.toString(),
      unpaid_amount: unpaidCny.toFixed(2),
      unpaid_rate: reference.rate.toString(),
    };
  }

  /** The USD rate for cargo expenses entered in dollars (§5.2, §10.1). */
  async suggestUsd(db: Db = this.prisma): Promise<RateSuggestion> {
    void db;
    const reference = await this.referenceRate.forCurrency(currency_code.USD);
    return {
      rate: reference.rate,
      source:
        reference.source === 'MANUAL' ? rate_source.MANUAL : rate_source.REFERENCE,
      paid_amount: ZERO.toFixed(2),
      paid_rate: null,
      unpaid_amount: ZERO.toFixed(2),
      unpaid_rate: reference.rate.toString(),
    };
  }
}
