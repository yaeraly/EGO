import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type InventoryFull = Prisma.inventoriesGetPayload<{
  include: {
    inventory_lines: true;
    warehouses: true;
    documents: true;
  };
}>;

@Injectable()
export class InventoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: { documentId: string; warehouseId: string; isFull: boolean },
  ) {
    return tx.inventories.create({
      data: {
        document_id: data.documentId,
        warehouse_id: data.warehouseId,
        is_full: data.isFull,
      },
    });
  }

  insertLines(
    tx: Prisma.TransactionClient,
    inventoryId: string,
    lines: {
      productId: string;
      systemQty: Prisma.Decimal;
    }[],
  ) {
    return tx.inventory_lines.createMany({
      data: lines.map((line) => ({
        inventory_id: inventoryId,
        product_id: line.productId,
        system_qty: line.systemQty,
        // Until someone counts, the shelf is assumed to agree with the system;
        // a line nobody touched must not report a shortage of everything.
        actual_qty: line.systemQty,
        diff_qty: new Prisma.Decimal(0),
      })),
    });
  }

  findById(db: Db, id: string): Promise<InventoryFull | null> {
    return db.inventories.findUnique({
      where: { document_id: id },
      include: { inventory_lines: true, warehouses: true, documents: true },
    });
  }

  findMany(filter: { warehouseId?: string }): Promise<InventoryFull[]> {
    return this.prisma.inventories.findMany({
      where: filter.warehouseId ? { warehouse_id: filter.warehouseId } : {},
      include: { inventory_lines: true, warehouses: true, documents: true },
      orderBy: { documents: { created_at: 'desc' } },
      take: 100,
    });
  }

  updateLine(
    tx: Prisma.TransactionClient,
    lineId: string,
    data: {
      actualQty: Prisma.Decimal;
      diffQty: Prisma.Decimal;
      layerId?: string | null;
      responsible?: string | null;
    },
  ) {
    return tx.inventory_lines.update({
      where: { id: lineId },
      data: {
        actual_qty: data.actualQty,
        diff_qty: data.diffQty,
        ...(data.layerId === undefined ? {} : { layer_id: data.layerId }),
        ...(data.responsible === undefined
          ? {}
          : { responsible: data.responsible }),
      },
    });
  }

  /**
   * When each warehouse was last counted in full (§22).
   *
   * Only confirmed full counts answer the question — a draft nobody finished
   * is not a count, and a spot check of three products is not a full one.
   */
  async lastFullCount(db: Db): Promise<Map<string, Date>> {
    const rows = await db.$queryRaw<{ warehouse_id: string; at: Date }[]>`
      SELECT i.warehouse_id, MAX(d.business_date) AS at
      FROM inventories i
      JOIN documents d ON d.id = i.document_id
      WHERE i.is_full = true
        AND d.status = 'CONFIRMED'
      GROUP BY i.warehouse_id
    `;
    return new Map(rows.map((row) => [row.warehouse_id, row.at]));
  }
}
