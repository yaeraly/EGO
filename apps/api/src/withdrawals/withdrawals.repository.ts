import { Injectable } from '@nestjs/common';
import { Prisma, currency_code, withdrawal_docs, withdrawal_type } from '@prisma/client';

@Injectable()
export class WithdrawalsRepository {
  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      wtype: withdrawal_type;
      investorId: string | null;
      accountId: string;
      amount: Prisma.Decimal;
      currency: currency_code;
      linkedCapitalDoc: string | null;
      purpose: string;
    },
  ): Promise<withdrawal_docs> {
    return tx.withdrawal_docs.create({
      data: {
        document_id: data.documentId,
        wtype: data.wtype,
        investor_id: data.investorId,
        account_id: data.accountId,
        amount: data.amount,
        currency: data.currency,
        linked_capital_doc: data.linkedCapitalDoc,
        purpose: data.purpose,
      },
    });
  }

  findByDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<withdrawal_docs | null> {
    return tx.withdrawal_docs.findUnique({ where: { document_id: documentId } });
  }
}
