import { Injectable } from '@nestjs/common';
import { Prisma, cargo_payments, currency_code } from '@prisma/client';
import { Db } from '../common/db';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class CargoPaymentsRepository {
  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      cargoCompanyId: string;
      fromAccount: string;
      amount: Prisma.Decimal;
      currency: currency_code;
      rate: Prisma.Decimal | null;
    },
  ): Promise<cargo_payments> {
    return tx.cargo_payments.create({
      data: {
        document_id: data.documentId,
        cargo_company_id: data.cargoCompanyId,
        from_account: data.fromAccount,
        amount: data.amount,
        currency: data.currency,
        rate: data.rate,
        // Filled in when the document posts; a draft has moved no money.
        kgs_value: ZERO,
      },
    });
  }

  findByDocument(db: Db, documentId: string): Promise<cargo_payments | null> {
    return db.cargo_payments.findUnique({
      where: { document_id: documentId },
    });
  }

  async recordPosting(
    tx: Prisma.TransactionClient,
    documentId: string,
    data: {
      kgsValue: Prisma.Decimal;
      rate: Prisma.Decimal;
      fxGainLossKgs: Prisma.Decimal;
    },
  ): Promise<void> {
    await tx.cargo_payments.update({
      where: { document_id: documentId },
      data: {
        kgs_value: data.kgsValue,
        rate: data.rate,
        fx_gain_loss_kgs: data.fxGainLossKgs,
      },
    });
  }
}
