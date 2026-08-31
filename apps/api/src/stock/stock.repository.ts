import { Injectable } from '@nestjs/common';
import { Prisma, fifo_layers, stock_movement_type } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export interface LayerStockRow {
  layer_id: string;
  warehouse_id: string;
  qty: Prisma.Decimal;
}

/**
 * The only place `layer_stock` and `stock_movements` are written.
 *
 * Everything here takes an explicit transaction client: stock changes are
 * never standalone — they belong to the document that caused them (§42.4).
 */
@Injectable()
export class StockRepository {
  constructor(private readonly prisma: PrismaService) {}

  insertLayer(
    tx: Prisma.TransactionClient,
    data: {
      productId: string;
      source: Prisma.fifo_layersCreateInput['source'];
      lotItemId: string | null;
      sourceDocId: string | null;
      layerDate: Date;
      unitCost: Prisma.Decimal;
      initialQty: Prisma.Decimal;
    },
  ): Promise<fifo_layers> {
    return tx.fifo_layers.create({
      data: {
        product_id: data.productId,
        source: data.source,
        lot_item_id: data.lotItemId,
        source_doc_id: data.sourceDocId,
        layer_date: data.layerDate,
        unit_cost: data.unitCost,
        initial_qty: data.initialQty,
      },
    });
  }

  findLayer(db: Db, layerId: string): Promise<fifo_layers | null> {
    return db.fifo_layers.findUnique({ where: { id: layerId } });
  }

  /**
   * Locks one layer's stock in one warehouse and returns the quantity.
   *
   * The lock is what keeps the balance safe to act on: without it two
   * concurrent sales each read enough stock and both post, driving the row
   * negative in defiance of §42.5. `FOR UPDATE` holds the row for the rest of
   * the transaction, serialising every movement on it.
   *
   * Returns null when there is no row yet — nothing has ever been put there.
   */
  async lockStock(
    tx: Prisma.TransactionClient,
    layerId: string,
    warehouseId: string,
  ): Promise<Prisma.Decimal | null> {
    const rows = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT qty FROM layer_stock
      WHERE layer_id = ${layerId}::uuid AND warehouse_id = ${warehouseId}::uuid
      FOR UPDATE
    `;
    return rows[0]?.qty ?? null;
  }

  /**
   * Adds stock to one layer in one warehouse, creating the row if needed.
   *
   * Only ever called with a positive quantity. A removal goes through
   * `subtractStock`, because `INSERT ... ON CONFLICT` evaluates the table's
   * CHECK constraints against the tuple it proposes to insert *before* it
   * detects the conflict — so a negative delta is rejected by
   * `qty >= 0` even when the update it would perform is perfectly valid.
   */
  async addStock(
    tx: Prisma.TransactionClient,
    layerId: string,
    warehouseId: string,
    qty: Prisma.Decimal,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO layer_stock (layer_id, warehouse_id, qty)
      VALUES (${layerId}::uuid, ${warehouseId}::uuid, ${qty})
      ON CONFLICT (layer_id, warehouse_id)
      DO UPDATE SET qty = layer_stock.qty + EXCLUDED.qty
    `;
  }

  /**
   * Takes stock off one layer in one warehouse.
   *
   * The caller has already locked the row and checked the quantity; this
   * updates in place, and the column's own CHECK (qty >= 0) aborts the
   * transaction if that check was ever skipped (§42.5).
   */
  async subtractStock(
    tx: Prisma.TransactionClient,
    layerId: string,
    warehouseId: string,
    qty: Prisma.Decimal,
  ): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE layer_stock SET qty = qty - ${qty}
      WHERE layer_id = ${layerId}::uuid AND warehouse_id = ${warehouseId}::uuid
    `;
    if (updated === 0) {
      throw new Error(
        `No stock row for layer ${layerId} in warehouse ${warehouseId}`,
      );
    }
  }

  insertMovement(
    tx: Prisma.TransactionClient,
    data: {
      mtype: stock_movement_type;
      layerId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      documentId: string;
    },
  ): Promise<void> {
    return tx.stock_movements
      .create({
        data: {
          mtype: data.mtype,
          layer_id: data.layerId,
          warehouse_id: data.warehouseId,
          qty: data.qty,
          unit_cost: data.unitCost,
          document_id: data.documentId,
        },
      })
      .then(() => undefined);
  }

  /** Layers of one product that still hold stock, oldest first (§18). */
  availableLayers(
    db: Db,
    productId: string,
    warehouseId: string,
  ): Promise<
    { layer_id: string; qty: Prisma.Decimal; unit_cost: Prisma.Decimal; layer_date: Date }[]
  > {
    return db.$queryRaw`
      SELECT s.layer_id, s.qty, l.unit_cost, l.layer_date
      FROM layer_stock s
      JOIN fifo_layers l ON l.id = s.layer_id
      WHERE s.warehouse_id = ${warehouseId}::uuid
        AND l.product_id = ${productId}::uuid
        AND s.qty > 0
      ORDER BY l.layer_date ASC, l.created_at ASC, l.id ASC
    `;
  }

  /** Every layer of one product with stock anywhere, for the product card. */
  layersForProduct(
    db: Db,
    productId: string,
  ): Promise<
    {
      layer_id: string;
      warehouse_id: string;
      warehouse_code: string;
      warehouse_type: string;
      qty: Prisma.Decimal;
      unit_cost: Prisma.Decimal;
      layer_date: Date;
      source: string;
      lot_number: string | null;
    }[]
  > {
    return db.$queryRaw`
      SELECT s.layer_id, s.warehouse_id, w.code AS warehouse_code,
             w.wtype::text AS warehouse_type, s.qty, l.unit_cost,
             l.layer_date, l.source::text AS source, d.doc_number AS lot_number
      FROM layer_stock s
      JOIN fifo_layers l ON l.id = s.layer_id
      JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN lot_items li ON li.id = l.lot_item_id
      LEFT JOIN documents d ON d.id = li.lot_id
      WHERE l.product_id = ${productId}::uuid AND s.qty > 0
      ORDER BY l.layer_date ASC, l.created_at ASC
    `;
  }

  /**
   * On-hand quantity and value per product per warehouse.
   *
   * MAIN and DEFECT are reported apart because §28 values them separately
   * and §12-А.6 keeps DEFECT out of what is for sale.
   */
  stockByProduct(
    db: Db,
    filter: { productId?: string; warehouseId?: string },
  ): Promise<
    {
      product_id: string;
      sku: string;
      name: string;
      warehouse_id: string;
      warehouse_code: string;
      warehouse_type: string;
      qty: Prisma.Decimal;
      value_kgs: Prisma.Decimal;
    }[]
  > {
    return db.$queryRaw`
      SELECT p.id AS product_id, p.sku, p.name,
             w.id AS warehouse_id, w.code AS warehouse_code,
             w.wtype::text AS warehouse_type,
             SUM(s.qty) AS qty,
             SUM(s.qty * l.unit_cost) AS value_kgs
      FROM layer_stock s
      JOIN fifo_layers l ON l.id = s.layer_id
      JOIN products p ON p.id = l.product_id
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.qty > 0
        AND (${filter.productId ?? null}::uuid IS NULL OR p.id = ${filter.productId ?? null}::uuid)
        AND (${filter.warehouseId ?? null}::uuid IS NULL OR w.id = ${filter.warehouseId ?? null}::uuid)
      GROUP BY p.id, p.sku, p.name, w.id, w.code, w.wtype
      ORDER BY p.sku, w.code
    `;
  }

  movementsForDocument(db: Db, documentId: string) {
    return db.stock_movements.findMany({
      where: { document_id: documentId },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Unit cost of the oldest layer still holding stock — the cost the next
   * unit out would carry (§13.3, §18).
   *
   * `warehouseId` narrows it to one warehouse; without it the question is
   * "what does the next unit cost anywhere it can be sold from", so only MAIN
   * counts — DEFECT stock is not for sale (§12-А.6).
   */
  async oldestUnitCost(
    db: Db,
    productId: string,
    warehouseId?: string,
  ): Promise<Prisma.Decimal | null> {
    const rows = warehouseId
      ? await db.$queryRaw<{ unit_cost: Prisma.Decimal }[]>`
          SELECT l.unit_cost
          FROM layer_stock s
          JOIN fifo_layers l ON l.id = s.layer_id
          WHERE s.warehouse_id = ${warehouseId}::uuid
            AND l.product_id = ${productId}::uuid
            AND s.qty > 0
          ORDER BY l.layer_date ASC, l.created_at ASC, l.id ASC
          LIMIT 1
        `
      : await db.$queryRaw<{ unit_cost: Prisma.Decimal }[]>`
          SELECT l.unit_cost
          FROM layer_stock s
          JOIN fifo_layers l ON l.id = s.layer_id
          JOIN warehouses w ON w.id = s.warehouse_id
          WHERE l.product_id = ${productId}::uuid
            AND s.qty > 0
            AND w.wtype = 'MAIN'
          ORDER BY l.layer_date ASC, l.created_at ASC, l.id ASC
          LIMIT 1
        `;
    return rows[0]?.unit_cost ?? null;
  }
}
