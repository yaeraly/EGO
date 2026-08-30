import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, currency_layers } from '@prisma/client';
import { roundMoney } from '../common/decimal';

export interface ConsumedLayer {
  layer_id: string;
  amount: Prisma.Decimal;
  rate_kgs: Prisma.Decimal;
  kgs_value: Prisma.Decimal;
}

export interface ConsumptionResult {
  /** Σ of the consumption lines — the payment's KGS cost basis. */
  kgsValue: Prisma.Decimal;
  layers: ConsumedLayer[];
}

const ZERO = new Prisma.Decimal(0);

/**
 * Currency cash FIFO (§10-А.3).
 *
 * A foreign-currency till holds money bought at different rates, and its KGS
 * value is not one average — it is the sum of the layers still in it. Each
 * purchase adds a layer at its own rate; each payment out takes from the
 * oldest layer first and carries that layer's rate as its "actual rate".
 *
 * SPY and CPY (Priority 1, later modules) consume through this same service.
 */
@Injectable()
export class CurrencyFifoService {
  /**
   * Records currency arriving in a till at a known KGS rate.
   *
   * Every unit of foreign currency in an account must belong to a layer, or
   * the account's KGS value becomes unknowable the moment it is spent.
   */
  async createLayer(
    tx: Prisma.TransactionClient,
    params: {
      accountId: string;
      documentId: string;
      amount: Prisma.Decimal;
      rateKgs: Prisma.Decimal;
    },
  ): Promise<currency_layers> {
    return tx.currency_layers.create({
      data: {
        account_id: params.accountId,
        cex_document_id: params.documentId,
        original_amount: params.amount,
        remaining_amount: params.amount,
        rate_kgs: params.rateKgs,
      },
    });
  }

  /**
   * Takes `amount` out of an account's layers, oldest first, and records what
   * came from where.
   *
   * Returns the KGS cost basis: Σ(taken × that layer's rate). The caller uses
   * it as the payment's KGS value (SPY, CPY) or to compute FX gain/loss
   * against what was actually received (reverse CEX).
   *
   * The layers are locked FOR UPDATE in FIFO order, so two concurrent payments
   * out of the same till cannot both consume the same layer.
   */
  async consumeCurrency(
    tx: Prisma.TransactionClient,
    params: {
      accountId: string;
      amount: Prisma.Decimal;
      documentId: string;
      accountName?: string;
    },
  ): Promise<ConsumptionResult> {
    const layers = await tx.$queryRaw<currency_layers[]>`
      SELECT * FROM currency_layers
      WHERE account_id = ${params.accountId}::uuid AND remaining_amount > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `;

    let outstanding = params.amount;
    const consumed: ConsumedLayer[] = [];

    for (const layer of layers) {
      if (outstanding.lessThanOrEqualTo(0)) {
        break;
      }

      const take = Prisma.Decimal.min(layer.remaining_amount, outstanding);
      const kgsValue = roundMoney(take.times(layer.rate_kgs));

      await tx.currency_layer_consumptions.create({
        data: {
          layer_id: layer.id,
          document_id: params.documentId,
          amount: take,
          kgs_value: kgsValue,
        },
      });

      await tx.currency_layers.update({
        where: { id: layer.id },
        data: { remaining_amount: layer.remaining_amount.minus(take) },
      });

      consumed.push({
        layer_id: layer.id,
        amount: take,
        rate_kgs: layer.rate_kgs,
        kgs_value: kgsValue,
      });
      outstanding = outstanding.minus(take);
    }

    // §10-А.4: a currency till can never go negative. The shortfall is
    // reported in the currency itself, since that is what the operator has to
    // go and buy.
    if (outstanding.greaterThan(0)) {
      const available = params.amount.minus(outstanding);
      throw new ConflictException(
        `${params.accountName ?? 'Currency account'} holds ${available.toFixed(2)}, ` +
          `which is not enough for ${params.amount.toFixed(2)}; buy currency first (CEX)`,
      );
    }

    return {
      // The sum of the recorded lines, not a re-derived total: the lines are
      // the record, and re-multiplying would let a rounded cent drift.
      kgsValue: consumed.reduce((sum, l) => sum.plus(l.kgs_value), ZERO),
      layers: consumed,
    };
  }

  /**
   * Currency still held, by layer. Must equal the account's balance — the two
   * are maintained together, and a gap means a movement bypassed the layers.
   */
  async remaining(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<Prisma.Decimal> {
    const [{ total }] = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(remaining_amount), 0) AS total
      FROM currency_layers
      WHERE account_id = ${accountId}::uuid
    `;
    return total ?? ZERO;
  }
}
