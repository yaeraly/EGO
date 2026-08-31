import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

/** The last confirmed order this product appeared on (§12-Б.5). */
export interface LastPurchase {
  document_id: string;
  doc_number: string;
  business_date: Date;
  qty: Prisma.Decimal;
  price_cny: Prisma.Decimal;
}

@Injectable()
export class ProductCardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §12-Б.5 asks the card to show the last purchase price, its currency and
   * date. Nothing is stored on the product for it: the orders themselves are
   * the record, and reading them keeps the card from drifting away from the
   * documents (CLAUDE.md invariant 1). Only CONFIRMED orders count — a draft
   * is not a price anyone agreed to.
   */
  async lastPurchase(db: Db, productId: string): Promise<LastPurchase | null> {
    const [row] = await db.$queryRaw<LastPurchase[]>`
      SELECT d.id AS document_id, d.doc_number, d.business_date,
             i.qty, i.price_cny
      FROM purchase_items i
      JOIN purchases p ON p.document_id = i.purchase_id
      JOIN documents d ON d.id = p.document_id
      WHERE i.product_id = ${productId}::uuid
        AND d.status = 'CONFIRMED'
      ORDER BY d.business_date DESC, d.doc_number DESC
      LIMIT 1
    `;
    return row ?? null;
  }

  /** The last confirmed receipt that actually brought some in (§12-Б.5). */
  async lastReceiptDate(db: Db, productId: string): Promise<Date | null> {
    const [row] = await db.$queryRaw<{ business_date: Date }[]>`
      SELECT d.business_date
      FROM receipt_items i
      JOIN receipts r ON r.document_id = i.receipt_id
      JOIN documents d ON d.id = r.document_id
      WHERE i.product_id = ${productId}::uuid
        AND i.received_qty > 0
        AND d.status = 'CONFIRMED'
      ORDER BY d.business_date DESC
      LIMIT 1
    `;
    return row?.business_date ?? null;
  }

  /**
   * Inbound qty (§12-Б.4): ordered on confirmed purchases, not yet received.
   *
   * Receipts are matched through their own purchase, so goods received
   * against a different order never cancel this one out. Floored at zero —
   * an over-receipt (§8.8 EXCESS) is not negative inbound.
   */
  async inboundQty(db: Db, productId: string): Promise<Prisma.Decimal> {
    const [row] = await db.$queryRaw<{ inbound: Prisma.Decimal | null }[]>`
      SELECT SUM(GREATEST(ordered.qty - COALESCE(received.qty, 0), 0)) AS inbound
      FROM (
        SELECT i.purchase_id, SUM(i.qty) AS qty
        FROM purchase_items i
        JOIN documents d ON d.id = i.purchase_id
        WHERE i.product_id = ${productId}::uuid
          AND d.status = 'CONFIRMED'
        GROUP BY i.purchase_id
      ) ordered
      LEFT JOIN (
        SELECT r.purchase_id, SUM(i.received_qty) AS qty
        FROM receipt_items i
        JOIN receipts r ON r.document_id = i.receipt_id
        JOIN documents d ON d.id = r.document_id
        WHERE i.product_id = ${productId}::uuid
          AND d.status = 'CONFIRMED'
        GROUP BY r.purchase_id
      ) received ON received.purchase_id = ordered.purchase_id
    `;
    return row?.inbound ?? new Prisma.Decimal(0);
  }
}
