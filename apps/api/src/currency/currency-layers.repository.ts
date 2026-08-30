import { Injectable } from '@nestjs/common';
import { Prisma, currency_layers } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class CurrencyLayersRepository {
  /**
   * The account's unspent layers, oldest first, held for the rest of the
   * transaction (§10-А.3).
   *
   * The lock is what stops two concurrent payments out of the same till from
   * both consuming the same layer.
   */
  lockOpenLayers(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<currency_layers[]> {
    return tx.$queryRaw<currency_layers[]>`
      SELECT * FROM currency_layers
      WHERE account_id = ${accountId}::uuid AND remaining_amount > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `;
  }

  insertLayer(
    tx: Prisma.TransactionClient,
    data: {
      accountId: string;
      documentId: string;
      amount: Prisma.Decimal;
      rateKgs: Prisma.Decimal;
    },
  ): Promise<currency_layers> {
    return tx.currency_layers.create({
      data: {
        account_id: data.accountId,
        cex_document_id: data.documentId,
        original_amount: data.amount,
        remaining_amount: data.amount,
        rate_kgs: data.rateKgs,
      },
    });
  }

  async insertConsumption(
    tx: Prisma.TransactionClient,
    data: {
      layerId: string;
      documentId: string;
      amount: Prisma.Decimal;
      kgsValue: Prisma.Decimal;
    },
  ): Promise<void> {
    await tx.currency_layer_consumptions.create({
      data: {
        layer_id: data.layerId,
        document_id: data.documentId,
        amount: data.amount,
        kgs_value: data.kgsValue,
      },
    });
  }

  async reduceRemaining(
    tx: Prisma.TransactionClient,
    layerId: string,
    remaining: Prisma.Decimal,
  ): Promise<void> {
    await tx.currency_layers.update({
      where: { id: layerId },
      data: { remaining_amount: remaining },
    });
  }

  async totalRemaining(
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
