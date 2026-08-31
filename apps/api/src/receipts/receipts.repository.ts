import { Injectable } from '@nestjs/common';
import {
  Prisma,
  expense_alloc_basis,
  currency_code,
  rate_source,
  receipt_expense_type,
  receipt_expenses,
  receipt_items,
  receipt_status,
  receipts,
} from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type ReceiptFull = Prisma.receiptsGetPayload<{
  include: {
    receipt_items: { include: { products: true } };
    receipt_expenses: { include: { receipt_expense_manual_allocations: true } };
    purchases: { include: { purchase_items: true; suppliers: true } };
  };
}>;

@Injectable()
export class ReceiptsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: { documentId: string; purchaseId: string },
  ): Promise<receipts> {
    return tx.receipts.create({
      data: { document_id: data.documentId, purchase_id: data.purchaseId },
    });
  }

  insertItems(
    tx: Prisma.TransactionClient,
    receiptId: string,
    items: {
      productId: string;
      position: number;
      orderedQty: Prisma.Decimal;
      receivedQty: Prisma.Decimal;
    }[],
  ): Promise<Prisma.BatchPayload> {
    return tx.receipt_items.createMany({
      data: items.map((item) => ({
        receipt_id: receiptId,
        product_id: item.productId,
        position: item.position,
        ordered_qty: item.orderedQty,
        received_qty: item.receivedQty,
      })),
    });
  }

  updateItem(
    tx: Prisma.TransactionClient,
    id: string,
    data: { receivedQty: Prisma.Decimal; damagedQty: Prisma.Decimal },
  ): Promise<receipt_items> {
    return tx.receipt_items.update({
      where: { id },
      data: { received_qty: data.receivedQty, damaged_qty: data.damagedQty },
    });
  }

  findById(db: Db, documentId: string): Promise<ReceiptFull | null> {
    return db.receipts.findUnique({
      where: { document_id: documentId },
      include: {
        receipt_items: {
          include: { products: true },
          orderBy: { position: 'asc' },
        },
        receipt_expenses: {
          include: { receipt_expense_manual_allocations: true },
          orderBy: { id: 'asc' },
        },
        purchases: { include: { purchase_items: true, suppliers: true } },
      },
    });
  }

  findByPurchase(db: Db, purchaseId: string): Promise<receipts[]> {
    return db.receipts.findMany({ where: { purchase_id: purchaseId } });
  }

  async setStatus(
    tx: Prisma.TransactionClient,
    documentId: string,
    rstatus: receipt_status,
  ): Promise<void> {
    await tx.receipts.update({
      where: { document_id: documentId },
      data: { rstatus },
    });
  }

  async setRates(
    tx: Prisma.TransactionClient,
    documentId: string,
    data: {
      rateCny: Prisma.Decimal | null;
      rateCnySource: rate_source | null;
      rateUsd: Prisma.Decimal | null;
      rateUsdSource: rate_source | null;
    },
  ): Promise<void> {
    await tx.receipts.update({
      where: { document_id: documentId },
      data: {
        rate_cny: data.rateCny,
        rate_cny_source: data.rateCnySource,
        rate_usd: data.rateUsd,
        rate_usd_source: data.rateUsdSource,
      },
    });
  }

  insertExpense(
    tx: Prisma.TransactionClient,
    data: {
      receiptId: string;
      etype: receipt_expense_type;
      amount: Prisma.Decimal;
      currency: currency_code;
      rate: Prisma.Decimal | null;
      rateSource: rate_source | null;
      kgsAmount: Prisma.Decimal;
      allocBasis: expense_alloc_basis;
      isPaid: boolean;
    },
  ): Promise<receipt_expenses> {
    return tx.receipt_expenses.create({
      data: {
        receipt_id: data.receiptId,
        etype: data.etype,
        amount: data.amount,
        currency: data.currency,
        rate: data.rate,
        rate_source: data.rateSource,
        kgs_amount: data.kgsAmount,
        alloc_basis: data.allocBasis,
        is_paid: data.isPaid,
      },
    });
  }

  deleteExpense(tx: Prisma.TransactionClient, id: string) {
    return tx.receipt_expenses.delete({ where: { id } });
  }

  findExpense(db: Db, id: string): Promise<receipt_expenses | null> {
    return db.receipt_expenses.findUnique({ where: { id } });
  }

  async replaceManualAllocations(
    tx: Prisma.TransactionClient,
    expenseId: string,
    rows: { receiptItemId: string; amountKgs: Prisma.Decimal }[],
  ): Promise<void> {
    await tx.receipt_expense_manual_allocations.deleteMany({
      where: { expense_id: expenseId },
    });
    if (rows.length > 0) {
      await tx.receipt_expense_manual_allocations.createMany({
        data: rows.map((row) => ({
          expense_id: expenseId,
          receipt_item_id: row.receiptItemId,
          amount_kgs: row.amountKgs,
        })),
      });
    }
  }

  /** Locks the receipt row so two people cannot confirm it at once. */
  async lock(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<{ rstatus: receipt_status } | null> {
    const rows = await tx.$queryRaw<{ rstatus: receipt_status }[]>`
      SELECT rstatus FROM receipts WHERE document_id = ${documentId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  findMany(filter: { purchaseId?: string; status?: receipt_status }) {
    return this.prisma.receipts.findMany({
      where: {
        ...(filter.purchaseId ? { purchase_id: filter.purchaseId } : {}),
        ...(filter.status ? { rstatus: filter.status } : {}),
      },
      include: {
        documents: { select: { doc_number: true, business_date: true, status: true } },
        purchases: {
          include: { suppliers: { select: { id: true, name: true } } },
        },
      },
      orderBy: { documents: { created_at: 'desc' } },
    });
  }
}
