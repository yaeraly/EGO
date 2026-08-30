import { Injectable } from '@nestjs/common';
import { Prisma, supplier_payments } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class SupplierPaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      supplierId: string;
      fromAccount: string;
      amountCny: Prisma.Decimal;
      purchaseId: string | null;
      channel: string | null;
    },
  ): Promise<supplier_payments> {
    return tx.supplier_payments.create({
      data: {
        document_id: data.documentId,
        supplier_id: data.supplierId,
        from_account: data.fromAccount,
        amount_cny: data.amountCny,
        // Filled in when the document posts; a draft has moved no money.
        kgs_value: ZERO,
        purchase_id: data.purchaseId,
        channel: data.channel,
      },
    });
  }

  findByDocument(
    db: Db,
    documentId: string,
  ): Promise<supplier_payments | null> {
    return db.supplier_payments.findUnique({
      where: { document_id: documentId },
    });
  }

  async recordPosting(
    tx: Prisma.TransactionClient,
    documentId: string,
    data: {
      kgsValue: Prisma.Decimal;
      debtPartCny: Prisma.Decimal;
      prepayPartCny: Prisma.Decimal;
      fxGainLossKgs: Prisma.Decimal;
    },
  ): Promise<void> {
    await tx.supplier_payments.update({
      where: { document_id: documentId },
      data: {
        kgs_value: data.kgsValue,
        debt_part_cny: data.debtPartCny,
        prepay_part_cny: data.prepayPartCny,
        fx_gain_loss_kgs: data.fxGainLossKgs,
      },
    });
  }

  /**
   * Confirmed payments against one purchase, for its payment status (§4.2).
   *
   * A draft payment has moved nothing, so it must not count towards "paid".
   */
  async confirmedTotalForPurchase(
    db: Db,
    purchaseId: string,
  ): Promise<Prisma.Decimal> {
    const [row] = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(p.amount_cny), 0) AS total
      FROM supplier_payments p
      JOIN documents d ON d.id = p.document_id
      WHERE p.purchase_id = ${purchaseId}::uuid AND d.status = 'CONFIRMED'
    `;
    return row.total ?? ZERO;
  }

  /** The same totals for a whole list of orders, in one query (§4.2). */
  async confirmedTotalsForPurchases(
    db: Db,
    purchaseIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const totals = new Map<string, Prisma.Decimal>(
      purchaseIds.map((id) => [id, ZERO]),
    );
    if (purchaseIds.length === 0) {
      return totals;
    }

    const rows = await db.$queryRaw<
      { purchase_id: string; total: Prisma.Decimal }[]
    >`
      SELECT p.purchase_id, COALESCE(SUM(p.amount_cny), 0) AS total
      FROM supplier_payments p
      JOIN documents d ON d.id = p.document_id
      WHERE p.purchase_id = ANY(${purchaseIds}::uuid[])
        AND d.status = 'CONFIRMED'
      GROUP BY p.purchase_id
    `;
    for (const row of rows) {
      totals.set(row.purchase_id, row.total);
    }
    return totals;
  }

  listForPurchase(db: Db, purchaseId: string): Promise<supplier_payments[]> {
    return db.supplier_payments.findMany({
      where: { purchase_id: purchaseId },
      orderBy: { document_id: 'asc' },
    });
  }
}
