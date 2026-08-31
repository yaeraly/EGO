import { Injectable } from '@nestjs/common';
import {
  Prisma,
  approval_status,
  debt_status,
  sale_items,
  sales,
} from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type SaleFull = Prisma.salesGetPayload<{
  include: {
    sale_items: { include: { products: true } };
    sale_payment_lines: { include: { payment_accounts: true } };
    customers: true;
  };
}>;

@Injectable()
export class SalesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      customerId: string;
      salesperson: string;
      isLossSale: boolean;
    },
  ): Promise<sales> {
    return tx.sales.create({
      data: {
        document_id: data.documentId,
        customer_id: data.customerId,
        salesperson: data.salesperson,
        is_loss_sale: data.isLossSale,
      },
    });
  }

  insertItems(
    tx: Prisma.TransactionClient,
    saleId: string,
    items: {
      productId: string;
      qty: Prisma.Decimal;
      /** Per unit, as the system suggested it (§13). */
      autoPrice: Prisma.Decimal;
      /** Per unit, after any discount (§13.1). */
      finalPrice: Prisma.Decimal;
      /** The money given away on this line — (auto − final) × qty (§13.8). */
      discountAmount: Prisma.Decimal;
      discountReason: string | null;
    }[],
  ): Promise<sale_items[]> {
    return Promise.all(
      items.map((item) =>
        tx.sale_items.create({
          data: {
            sale_id: saleId,
            product_id: item.productId,
            qty: item.qty,
            auto_price: item.autoPrice,
            final_price: item.finalPrice,
            discount_amount: item.discountAmount,
            discount_reason: item.discountReason,
          },
        }),
      ),
    );
  }

  deleteItems(tx: Prisma.TransactionClient, saleId: string) {
    return tx.sale_items.deleteMany({ where: { sale_id: saleId } });
  }

  insertPaymentLines(
    tx: Prisma.TransactionClient,
    saleId: string,
    lines: {
      accountId: string;
      amount: Prisma.Decimal;
      cashGiven: Prisma.Decimal | null;
      changeGiven: Prisma.Decimal | null;
    }[],
  ) {
    return tx.sale_payment_lines.createMany({
      data: lines.map((line) => ({
        sale_id: saleId,
        account_id: line.accountId,
        amount: line.amount,
        cash_given: line.cashGiven,
        change_given: line.changeGiven,
      })),
    });
  }

  deletePaymentLines(tx: Prisma.TransactionClient, saleId: string) {
    return tx.sale_payment_lines.deleteMany({ where: { sale_id: saleId } });
  }

  insertLayerAllocation(
    tx: Prisma.TransactionClient,
    data: {
      saleItemId: string;
      layerId: string;
      qty: Prisma.Decimal;
      unitCost: Prisma.Decimal;
    },
  ) {
    return tx.sale_layer_allocations.create({
      data: {
        sale_item_id: data.saleItemId,
        layer_id: data.layerId,
        qty: data.qty,
        unit_cost: data.unitCost,
      },
    });
  }

  async setItemCogs(
    tx: Prisma.TransactionClient,
    saleItemId: string,
    cogs: Prisma.Decimal,
  ): Promise<void> {
    await tx.sale_items.update({
      where: { id: saleItemId },
      data: { fifo_cogs: cogs },
    });
  }

  async setTotals(
    tx: Prisma.TransactionClient,
    saleId: string,
    data: {
      totalAmount: Prisma.Decimal;
      totalCogs: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
      debtDueDate: Date | null;
      debtStatus: debt_status | null;
    },
  ): Promise<void> {
    await tx.sales.update({
      where: { document_id: saleId },
      data: {
        total_amount: data.totalAmount,
        total_cogs: data.totalCogs,
        paid_amount: data.paidAmount,
        outstanding_amount: data.outstandingAmount,
        debt_due_date: data.debtDueDate,
        debt_status: data.debtStatus,
      },
    });
  }

  /**
   * Applies an allocated payment to a sale's debt (§16-А).
   *
   * The only place `paid_amount` and `outstanding_amount` move after a sale
   * is confirmed, and it moves them by allocation — never by a direct set.
   */
  async applyAllocation(
    tx: Prisma.TransactionClient,
    saleId: string,
    amount: Prisma.Decimal,
  ): Promise<sales> {
    const [locked] = await tx.$queryRaw<
      { total_amount: Prisma.Decimal; paid_amount: Prisma.Decimal }[]
    >`
      SELECT total_amount, paid_amount FROM sales
      WHERE document_id = ${saleId}::uuid FOR UPDATE
    `;

    const paid = locked.paid_amount.plus(amount);
    const outstanding = Prisma.Decimal.max(
      locked.total_amount.minus(paid),
      new Prisma.Decimal(0),
    );

    return tx.sales.update({
      where: { document_id: saleId },
      data: {
        paid_amount: paid,
        outstanding_amount: outstanding,
        debt_status: outstanding.isZero()
          ? debt_status.CLOSED
          : debt_status.PARTIALLY_PAID,
      },
    });
  }

  async setApproval(
    tx: Prisma.TransactionClient,
    saleId: string,
    data: {
      status: approval_status;
      ownerId?: string;
      reason?: string;
      requestedAt?: Date;
      decidedAt?: Date;
    },
  ): Promise<sales> {
    return tx.sales.update({
      where: { document_id: saleId },
      data: {
        approval_status: data.status,
        ...(data.ownerId ? { owner_approval_user: data.ownerId } : {}),
        ...(data.reason ? { owner_approval_reason: data.reason } : {}),
        ...(data.requestedAt ? { approval_requested_at: data.requestedAt } : {}),
        ...(data.decidedAt ? { approval_decided_at: data.decidedAt } : {}),
      },
    });
  }

  findById(db: Db, documentId: string): Promise<SaleFull | null> {
    return db.sales.findUnique({
      where: { document_id: documentId },
      include: {
        sale_items: { include: { products: true } },
        sale_payment_lines: { include: { payment_accounts: true } },
        customers: true,
      },
    });
  }

  /** Locks the sale row so two confirmations cannot race. */
  async lock(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<{ total_amount: Prisma.Decimal } | null> {
    const rows = await tx.$queryRaw<{ total_amount: Prisma.Decimal }[]>`
      SELECT total_amount FROM sales WHERE document_id = ${documentId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  findMany(filter: {
    customerId?: string;
    salesperson?: string;
    status?: string;
    limit?: number;
  }) {
    return this.prisma.sales.findMany({
      where: {
        ...(filter.customerId ? { customer_id: filter.customerId } : {}),
        ...(filter.salesperson ? { salesperson: filter.salesperson } : {}),
        ...(filter.status
          ? { documents_sales_document_idTodocuments: { status: filter.status as never } }
          : {}),
      },
      include: {
        documents_sales_document_idTodocuments: {
          select: { doc_number: true, business_date: true, status: true },
        },
        customers: { select: { id: true, name: true, is_walk_in: true } },
        sale_items: { include: { products: { select: { sku: true, name: true } } } },
      },
      orderBy: {
        documents_sales_document_idTodocuments: { created_at: 'desc' },
      },
      take: Math.min(filter.limit ?? 50, 200),
    });
  }

  /** Draft sales — a Day Close blocker, like an unreceived transfer. */
  openDrafts(db: Db) {
    return db.sales.findMany({
      where: { documents_sales_document_idTodocuments: { status: 'DRAFT' } },
      include: {
        documents_sales_document_idTodocuments: {
          select: { doc_number: true, business_date: true },
        },
      },
    });
  }
}
