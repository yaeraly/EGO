import { Injectable } from '@nestjs/common';
import { Prisma, currency_exchanges } from '@prisma/client';

@Injectable()
export class CurrencyExchangeRepository {
  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      fromAccount: string;
      toAccount: string;
      givenAmount: Prisma.Decimal;
      receivedAmount: Prisma.Decimal;
      rate: Prisma.Decimal;
      commission: Prisma.Decimal;
      intermediary: string | null;
    },
  ): Promise<currency_exchanges> {
    return tx.currency_exchanges.create({
      data: {
        document_id: data.documentId,
        from_account: data.fromAccount,
        to_account: data.toAccount,
        given_amount: data.givenAmount,
        received_amount: data.receivedAmount,
        rate: data.rate,
        commission: data.commission,
        intermediary: data.intermediary,
      },
    });
  }

  findByDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<currency_exchanges | null> {
    return tx.currency_exchanges.findUnique({
      where: { document_id: documentId },
    });
  }

  async setFxGainLoss(
    tx: Prisma.TransactionClient,
    documentId: string,
    value: Prisma.Decimal,
  ): Promise<void> {
    await tx.currency_exchanges.update({
      where: { document_id: documentId },
      data: { fx_gain_loss_kgs: value },
    });
  }
}
