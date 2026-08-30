import { Injectable } from '@nestjs/common';
import { Prisma, account_transfers } from '@prisma/client';

@Injectable()
export class TransfersRepository {
  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      fromAccount: string;
      toAccount: string;
      amount: Prisma.Decimal;
    },
  ): Promise<account_transfers> {
    return tx.account_transfers.create({
      data: {
        document_id: data.documentId,
        from_account: data.fromAccount,
        to_account: data.toAccount,
        amount: data.amount,
      },
    });
  }

  findByDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<account_transfers | null> {
    return tx.account_transfers.findUnique({
      where: { document_id: documentId },
    });
  }
}
