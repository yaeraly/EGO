import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  fifo_layer_source,
  fifo_layers,
  stock_movement_type,
  warehouse_type,
} from '@prisma/client';
import { Db } from '../common/db';
import { roundMoney } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { StockRepository } from './stock.repository';

const ZERO = new Prisma.Decimal(0);

export interface ProductStock {
  product_id: string;
  sku: string;
  name: string;
  /** Everything physically held, DEFECT included. */
  current_qty: string;
  /** Held against reservations. Zero until §17 lands. */
  reserved_qty: string;
  /** What a salesperson may actually sell: MAIN, less reservations. */
  available_qty: string;
  total_value_kgs: string;
  by_warehouse: {
    warehouse_id: string;
    code: string;
    wtype: string;
    qty: string;
    value_kgs: string;
  }[];
}

/** One layer a sale draws on, and what it costs (§18.1.4). */
export interface FifoPlanLine {
  layerId: string;
  qty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  /** qty × unitCost, at money scale. */
  cost: Prisma.Decimal;
  layerDate: Date;
}

export interface FifoPlan {
  lines: FifoPlanLine[];
  /** Σ line costs — the FIFO COGS of §13.3. */
  cogs: Prisma.Decimal;
}

export interface LayerView {
  layer_id: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_type: string;
  qty: string;
  unit_cost: string;
  value_kgs: string;
  layer_date: string;
  source: string;
  lot_number: string | null;
}

/**
 * Stock — the single door in and out of `layer_stock` (§12-А.8.3, §42.4–5).
 *
 * Three rules hold here and nowhere else, which is why nothing else in the
 * codebase writes those tables:
 *
 *   1. every change is a `stock_movements` row naming its document (§42.4);
 *   2. `layer_stock.qty` never goes below zero (§42.5) — checked under a row
 *      lock, and again by the column's own CHECK;
 *   3. a transfer moves goods without touching `unit_cost` (§12-А.5) — cost
 *      belongs to the layer, not to where the layer happens to sit.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: StockRepository,
    private readonly warehouses: WarehousesService,
  ) {}

  /**
   * Creates a FIFO layer and puts its goods in a warehouse (§18, §18.1).
   *
   * The layer *is* the cost: `unitCost` is fixed here and no code path
   * anywhere changes it afterwards (§18.1.6.3–4).
   */
  async createLayer(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      source: fifo_layer_source;
      lotItemId?: string | null;
      sourceDocId?: string | null;
      layerDate: Date;
      unitCost: Prisma.Decimal;
      qty: Prisma.Decimal;
      warehouseId: string;
      documentId: string;
      movementType?: stock_movement_type;
    },
  ): Promise<fifo_layers> {
    if (params.qty.lessThanOrEqualTo(0)) {
      throw new ConflictException(
        'A FIFO layer needs a positive quantity; a line that received nothing creates no layer (§18.1)',
      );
    }
    await this.warehouses.requireActive(params.warehouseId, tx);

    const layer = await this.repository.insertLayer(tx, {
      productId: params.productId,
      source: params.source,
      lotItemId: params.lotItemId ?? null,
      sourceDocId: params.sourceDocId ?? null,
      layerDate: params.layerDate,
      unitCost: params.unitCost,
      initialQty: params.qty,
    });

    await this.repository.addStock(
      tx,
      layer.id,
      params.warehouseId,
      params.qty,
    );
    await this.repository.insertMovement(tx, {
      mtype: params.movementType ?? stock_movement_type.RECEIPT_IN,
      layerId: layer.id,
      warehouseId: params.warehouseId,
      qty: params.qty,
      unitCost: params.unitCost,
      documentId: params.documentId,
    });

    return layer;
  }

  /**
   * Puts an existing layer's goods into a warehouse.
   *
   * Used for the second half of a transfer, and for a receipt that splits one
   * layer between MAIN and DEFECT (§8.4).
   */
  async addToWarehouse(
    tx: Prisma.TransactionClient,
    params: {
      layerId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      documentId: string;
      movementType: stock_movement_type;
    },
  ): Promise<void> {
    if (params.qty.lessThanOrEqualTo(0)) {
      throw new ConflictException('A stock movement needs a positive quantity');
    }
    await this.warehouses.requireActive(params.warehouseId, tx);

    const layer = await this.requireLayer(tx, params.layerId);

    await this.repository.addStock(
      tx,
      params.layerId,
      params.warehouseId,
      params.qty,
    );
    await this.repository.insertMovement(tx, {
      mtype: params.movementType,
      layerId: params.layerId,
      warehouseId: params.warehouseId,
      qty: params.qty,
      // Straight off the layer: a movement never restates the cost (§12-А.5).
      unitCost: layer.unit_cost,
      documentId: params.documentId,
    });
  }

  /**
   * Takes goods out of one layer in one warehouse.
   *
   * Refuses rather than going negative (§42.5, §12-А.8.8), and holds the row
   * for the rest of the transaction so two concurrent callers cannot both
   * pass the check.
   */
  async removeFromWarehouse(
    tx: Prisma.TransactionClient,
    params: {
      layerId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      documentId: string;
      movementType: stock_movement_type;
    },
  ): Promise<Prisma.Decimal> {
    if (params.qty.lessThanOrEqualTo(0)) {
      throw new ConflictException('A stock movement needs a positive quantity');
    }
    const warehouse = await this.warehouses.requireActive(
      params.warehouseId,
      tx,
    );
    const layer = await this.requireLayer(tx, params.layerId);

    const onHand = await this.repository.lockStock(
      tx,
      params.layerId,
      params.warehouseId,
    );
    const available = onHand ?? ZERO;

    if (available.lessThan(params.qty)) {
      throw new ConflictException(
        `${warehouse.code} holds ${available.toFixed(2)} of this layer, ` +
          `which is not enough for ${params.qty.toFixed(2)}; stock cannot go negative (§42.5)`,
      );
    }

    await this.repository.subtractStock(
      tx,
      params.layerId,
      params.warehouseId,
      params.qty,
    );
    await this.repository.insertMovement(tx, {
      mtype: params.movementType,
      layerId: params.layerId,
      warehouseId: params.warehouseId,
      qty: params.qty.negated(),
      unitCost: layer.unit_cost,
      documentId: params.documentId,
    });

    return layer.unit_cost;
  }

  /**
   * Which layers a sale of `qty` would come out of, oldest first (§18, §13.3).
   *
   * This is the single FIFO decision in the system. The sale screen calls it
   * to show the COGS before anything is committed, and `consumeFifo` calls it
   * again inside the confirming transaction to do the taking — the same
   * function, so a price checked against one cost can never be posted against
   * another.
   *
   * Refuses rather than partially filling: a sale of ten from eight in stock
   * is not eight units of sale, it is a mistake to report (§12-А.8.8).
   */
  async simulateFifo(
    db: Db,
    params: { productId: string; warehouseId: string; qty: Prisma.Decimal },
  ): Promise<FifoPlan> {
    if (params.qty.lessThanOrEqualTo(0)) {
      throw new ConflictException('A FIFO plan needs a positive quantity');
    }

    const layers = await this.repository.availableLayers(
      db,
      params.productId,
      params.warehouseId,
    );

    const lines: FifoPlanLine[] = [];
    let remaining = params.qty;
    let cogs = ZERO;

    for (const layer of layers) {
      if (remaining.lessThanOrEqualTo(0)) {
        break;
      }
      const take = Prisma.Decimal.min(remaining, layer.qty);
      lines.push({
        layerId: layer.layer_id,
        qty: take,
        unitCost: layer.unit_cost,
        cost: roundMoney(take.times(layer.unit_cost)),
        layerDate: layer.layer_date,
      });
      cogs = cogs.plus(roundMoney(take.times(layer.unit_cost)));
      remaining = remaining.minus(take);
    }

    if (remaining.greaterThan(0)) {
      const available = params.qty.minus(remaining);
      throw new ConflictException(
        `Складда ${available.toFixed(2)} гана бар, ${params.qty.toFixed(2)} сурал[д]ы — ` +
          'жетишсиз калдыкта сатуу блоктолот (§12-А.8.8)',
      );
    }

    return { lines, cogs };
  }

  /**
   * Takes the goods the plan names, under a lock (§18, §42.5).
   *
   * The plan is recomputed here rather than passed in: between the screen's
   * simulation and the confirm, someone else may have sold the same units.
   * Recomputing inside the transaction, with each layer locked as it is
   * taken, is what makes two concurrent sales of the last item resolve to
   * one sale and one refusal.
   */
  async consumeFifo(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      documentId: string;
      movementType?: stock_movement_type;
    },
  ): Promise<FifoPlan> {
    const plan = await this.simulateFifo(tx, params);

    for (const line of plan.lines) {
      await this.removeFromWarehouse(tx, {
        layerId: line.layerId,
        warehouseId: params.warehouseId,
        qty: line.qty,
        documentId: params.documentId,
        movementType: params.movementType ?? stock_movement_type.SALE_OUT,
      });
    }

    return plan;
  }

  /** On-hand for one layer in one warehouse, without locking. */
  async onHand(
    db: Db,
    layerId: string,
    warehouseId: string,
  ): Promise<Prisma.Decimal> {
    const row = await db.layer_stock.findUnique({
      where: { layer_id_warehouse_id: { layer_id: layerId, warehouse_id: warehouseId } },
      select: { qty: true },
    });
    return row?.qty ?? ZERO;
  }

  /**
   * Unit cost of the next unit out (§13.3): the oldest layer with stock.
   *
   * One definition, used by the sale screen's price suggestion and by the
   * product card alike — two definitions of "current cost" would eventually
   * disagree, and the price checked against one would post against the other.
   */
  oldestUnitCost(
    productId: string,
    warehouseId?: string,
    db: Db = this.prisma,
  ): Promise<Prisma.Decimal | null> {
    return this.repository.oldestUnitCost(db, productId, warehouseId);
  }

  /** Layers with stock, oldest first — the FIFO queue Module 4 will consume. */
  availableLayers(productId: string, warehouseId: string, db: Db = this.prisma) {
    return this.repository.availableLayers(db, productId, warehouseId);
  }

  async layersForProduct(
    productId: string,
    db: Db = this.prisma,
  ): Promise<LayerView[]> {
    const rows = await this.repository.layersForProduct(db, productId);
    return rows.map((row) => ({
      layer_id: row.layer_id,
      warehouse_id: row.warehouse_id,
      warehouse_code: row.warehouse_code,
      warehouse_type: row.warehouse_type,
      qty: row.qty.toFixed(2),
      unit_cost: row.unit_cost.toFixed(4),
      value_kgs: row.qty.times(row.unit_cost).toFixed(2),
      layer_date: row.layer_date.toISOString().slice(0, 10),
      source: row.source,
      lot_number: row.lot_number,
    }));
  }

  /**
   * Current / Reserved / Available per product (§12-А.2).
   *
   * Available counts MAIN only: DEFECT holds goods that are deliberately not
   * for sale (§12-А.6), and reporting them as available is exactly the
   * mistake that rule exists to prevent. Reserved is zero until §17
   * introduces reservations; it is named here so the arithmetic that reads it
   * does not have to change later.
   */
  async stockByProduct(
    filter: { productId?: string; warehouseId?: string } = {},
    db: Db = this.prisma,
  ): Promise<ProductStock[]> {
    const rows = await this.repository.stockByProduct(db, filter);
    const byProduct = new Map<string, ProductStock>();

    for (const row of rows) {
      let entry = byProduct.get(row.product_id);
      if (!entry) {
        entry = {
          product_id: row.product_id,
          sku: row.sku,
          name: row.name,
          current_qty: '0.00',
          reserved_qty: '0.00',
          available_qty: '0.00',
          total_value_kgs: '0.00',
          by_warehouse: [],
        };
        byProduct.set(row.product_id, entry);
      }

      entry.by_warehouse.push({
        warehouse_id: row.warehouse_id,
        code: row.warehouse_code,
        wtype: row.warehouse_type,
        qty: row.qty.toFixed(2),
        value_kgs: row.value_kgs.toFixed(2),
      });

      entry.current_qty = new Prisma.Decimal(entry.current_qty)
        .plus(row.qty)
        .toFixed(2);
      entry.total_value_kgs = new Prisma.Decimal(entry.total_value_kgs)
        .plus(row.value_kgs)
        .toFixed(2);

      if (row.warehouse_type === warehouse_type.MAIN) {
        entry.available_qty = new Prisma.Decimal(entry.available_qty)
          .plus(row.qty)
          .toFixed(2);
      }
    }

    for (const entry of byProduct.values()) {
      entry.available_qty = Prisma.Decimal.max(
        new Prisma.Decimal(entry.available_qty).minus(entry.reserved_qty),
        ZERO,
      ).toFixed(2);
    }

    return [...byProduct.values()];
  }

  movementsForDocument(documentId: string, db: Db = this.prisma) {
    return this.repository.movementsForDocument(db, documentId);
  }

  private async requireLayer(
    tx: Prisma.TransactionClient,
    layerId: string,
  ): Promise<fifo_layers> {
    const layer = await this.repository.findLayer(tx, layerId);
    if (!layer) {
      throw new NotFoundException('FIFO layer not found');
    }
    return layer;
  }
}
