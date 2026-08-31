import { Injectable } from '@nestjs/common';
import { Prisma, return_condition } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type ReturnFull = Prisma.returnsGetPayload<{
  include: {
    return_items: true;
    customers: true;
    documents: true;
  };
}>;

@Injectable()
export class ReturnsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      originalSale: string;
      customerId: string;
      totalReturnAmount: Prisma.Decimal;
      reason: string;
    },
  ) {
    return tx.returns.create({
      data: {
        document_id: data.documentId,
        original_sale: data.originalSale,
        customer_id: data.customerId,
        total_return_amount: data.totalReturnAmount,
        reason: data.reason,
      },
    });
  }

  insertItems(
    tx: Prisma.TransactionClient,
    returnId: string,
    items: {
      saleItemId: string;
      qty: Prisma.Decimal;
      condition: return_condition;
      originalPrice: Prisma.Decimal;
      originalUnitCost: Prisma.Decimal;
      warrantyOk: boolean | null;
    }[],
  ) {
    return tx.return_items.createMany({
      data: items.map((item) => ({
        return_id: returnId,
        sale_item_id: item.saleItemId,
        qty: item.qty,
        condition: item.condition,
        original_price: item.originalPrice,
        original_unit_cost: item.originalUnitCost,
        warranty_ok: item.warrantyOk,
      })),
    });
  }

  findById(db: Db, id: string): Promise<ReturnFull | null> {
    return db.returns.findUnique({
      where: { document_id: id },
      include: {
        return_items: true,
        customers: true,
        documents: true,
      },
    });
  }

  findMany(filter: {
    customerId?: string;
    originalSale?: string;
  }): Promise<ReturnFull[]> {
    return this.prisma.returns.findMany({
      where: {
        ...(filter.customerId ? { customer_id: filter.customerId } : {}),
        ...(filter.originalSale ? { original_sale: filter.originalSale } : {}),
      },
      include: {
        return_items: true,
        customers: true,
        documents: true,
      },
      orderBy: {
        documents: { created_at: 'desc' },
      },
      take: 100,
    });
  }

  setLayer(
    tx: Prisma.TransactionClient,
    itemId: string,
    layerId: string,
  ) {
    return tx.return_items.update({
      where: { id: itemId },
      data: { new_layer_id: layerId },
    });
  }

  setSettlement(
    tx: Prisma.TransactionClient,
    id: string,
    data: { debtOffset: Prisma.Decimal; cashRefund: Prisma.Decimal },
  ) {
    return tx.returns.update({
      where: { document_id: id },
      data: { debt_offset: data.debtOffset, cash_refund: data.cashRefund },
    });
  }

  setWarrantyException(
    tx: Prisma.TransactionClient,
    itemId: string,
    reason: string,
  ) {
    return tx.return_items.update({
      where: { id: itemId },
      data: { owner_exception_reason: reason },
    });
  }

  insertRefundLines(
    tx: Prisma.TransactionClient,
    returnId: string,
    lines: {
      accountId: string;
      amount: Prisma.Decimal;
      sourceOverrideReason: string | null;
    }[],
  ) {
    return tx.refund_lines.createMany({
      data: lines.map((line) => ({
        return_id: returnId,
        account_id: line.accountId,
        amount: line.amount,
        source_override_reason: line.sourceOverrideReason,
      })),
    });
  }

  /**
   * How much of each sale line has already come back (§35.7).
   *
   * Read inside the confirming transaction with the rows locked, so two
   * returns of the last unit cannot both pass the check.
   */
  async lockReturnedQty(
    tx: Prisma.TransactionClient,
    saleItemIds: string[],
  ): Promise<Map<string, { qty: Prisma.Decimal; returned: Prisma.Decimal }>> {
    const rows = await tx.$queryRaw<
      { id: string; qty: Prisma.Decimal; returned_qty: Prisma.Decimal }[]
    >`
      SELECT id, qty, returned_qty
      FROM sale_items
      WHERE id = ANY(${saleItemIds}::uuid[])
      ORDER BY id
      FOR UPDATE
    `;
    return new Map(
      rows.map((row) => [row.id, { qty: row.qty, returned: row.returned_qty }]),
    );
  }

  addReturnedQty(
    tx: Prisma.TransactionClient,
    saleItemId: string,
    qty: Prisma.Decimal,
  ) {
    return tx.sale_items.update({
      where: { id: saleItemId },
      data: { returned_qty: { increment: qty } },
    });
  }
}
