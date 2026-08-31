import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  doc_type,
  documents,
  fifo_layer_source,
  stock_movement_type,
  user_role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  ConfirmInventoryDto,
  CountDto,
  CreateInventoryDto,
} from './dto/inventory.dto';
import { InventoriesRepository, InventoryFull } from './inventories.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * What one confirmation has to carry from the controller to the poster.
 *
 * The OWNER's reason and the value they put on any surplus are decisions, not
 * request plumbing: §22 requires both, and the poster runs inside the
 * confirming transaction where the request object is long gone.
 */
@Injectable()
export class InventoryConfirmContext {
  private current: { reason: string; excessCosts: Map<string, Prisma.Decimal> } | null =
    null;

  set(value: { reason: string; excessCosts: Map<string, Prisma.Decimal> }): void {
    this.current = value;
  }

  take(): { reason: string; excessCosts: Map<string, Prisma.Decimal> } | null {
    const value = this.current;
    this.current = null;
    return value;
  }
}

/**
 * Inventory (INV) — §22.
 *
 * Counting is one thing and adjusting is another. A count records what was on
 * the shelf; confirming it is the Inventory Adjustment, which only the OWNER
 * may do and which always takes a PIN. The adjustment is made at LOT level:
 * a shortage traced to a batch comes off that batch, and one that cannot be
 * traced comes off the oldest, FIFO — because a missing unit costs what it
 * cost, not what an average says.
 */
@Injectable()
export class InventoriesService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.INV;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: InventoriesRepository,
    private readonly warehouses: WarehousesService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
    private readonly context: InventoryConfirmContext,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  /**
   * Opens a count sheet with the system's own figures already on it.
   *
   * The snapshot is taken now so the person counting has something to compare
   * against; the adjustment at confirmation reads stock again, because what
   * matters then is what is there at that moment.
   */
  async create(dto: CreateInventoryDto, userId: string): Promise<documents> {
    const warehouse = await this.warehouses.findOne(dto.warehouse_id);
    const isFull = dto.is_full ?? true;

    if (!isFull && !dto.product_ids?.length) {
      throw new BadRequestException(
        'Жарым-жартылай инвентаризацияда товарлар көрсөтүлүшү керек (§22)',
      );
    }

    const stock = await this.stock.stockByProduct({
      warehouseId: warehouse.id,
    });
    const counted = isFull
      ? stock
      : stock.filter((entry) => dto.product_ids!.includes(entry.product_id));

    // A partial count may name a product the warehouse holds none of — that
    // is a real answer ("we expected some and there are none"), so the line
    // is created with a system quantity of zero rather than dropped.
    const missing = isFull
      ? []
      : dto.product_ids!.filter(
          (id) => !counted.some((entry) => entry.product_id === id),
        );
    if (missing.length > 0) {
      await this.products.requireActive(this.prisma, missing);
    }

    if (counted.length === 0 && missing.length === 0) {
      throw new BadRequestException(
        `${warehouse.code} складында саноого товар жок`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.INV,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        warehouseId: warehouse.id,
        isFull,
      });

      await this.repository.insertLines(tx, document.id, [
        ...counted.map((entry) => ({
          productId: entry.product_id,
          systemQty: new Prisma.Decimal(
            entry.by_warehouse.find(
              (row) => row.warehouse_id === warehouse.id,
            )?.qty ?? entry.current_qty,
          ),
        })),
        ...missing.map((id) => ({ productId: id, systemQty: ZERO })),
      ]);

      return document;
    });
  }

  /** Records what was counted. The difference is computed, never typed in. */
  async count(id: string, dto: CountDto, userId: string): Promise<InventoryFull> {
    return this.prisma.$transaction(async (tx) => {
      const inventory = await this.requireDraft(tx, id);

      for (const line of dto.lines) {
        const stored = inventory.inventory_lines.find(
          (row) => row.id === line.line_id,
        );
        if (!stored) {
          throw new NotFoundException(`Сап табылган жок: ${line.line_id}`);
        }

        const actual = toDecimal(line.actual_qty, 'actual_qty');
        if (actual.isNegative()) {
          throw new BadRequestException('Фактический калдык терс болбойт');
        }

        await this.repository.updateLine(tx, stored.id, {
          actualQty: actual,
          diffQty: actual.minus(stored.system_qty),
          layerId: line.layer_id ?? null,
          responsible: line.responsible ?? userId,
        });
      }

      return this.requireInventory(tx, id);
    });
  }

  /**
   * The Inventory Adjustment itself (§22).
   *
   * OWNER only, PIN always, reason always — then the document is confirmed,
   * and the poster below moves the stock inside that same transaction.
   */
  async confirm(
    id: string,
    dto: ConfirmInventoryDto,
    user: { id: string; role: user_role },
    ip?: string,
  ): Promise<InventoryFull> {
    if (user.role !== user_role.OWNER) {
      throw new ForbiddenException(
        'Складдык корректировканы ЭЭСИ гана тастыктайт (§22)',
      );
    }

    const { valid } = await this.auth.verifyPin(user.id, dto.pin, {
      ip: ip ?? null,
      device: `inventory:${id}`,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }

    const inventory = await this.requireInventory(this.prisma, id);
    const excessCosts = new Map<string, Prisma.Decimal>();
    for (const entry of dto.excess_costs ?? []) {
      excessCosts.set(entry.line_id, toDecimal(entry.unit_cost, 'unit_cost'));
    }

    // Checked before the transaction so the message names every line at once
    // rather than failing on the first surplus with no price on it.
    const unpriced = inventory.inventory_lines.filter(
      (line) => line.diff_qty.greaterThan(ZERO) && !excessCosts.has(line.id),
    );
    if (unpriced.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'Ашыкча товардын наркын ЭЭСИ көрсөтүшү керек (§22) — баасы жок саптар бар',
        code: 'EXCESS_COST_REQUIRED',
        lines: unpriced.map((line) => ({
          line_id: line.id,
          product_id: line.product_id,
          diff_qty: line.diff_qty.toFixed(2),
        })),
      });
    }

    this.context.set({ reason: dto.reason.trim(), excessCosts });
    await this.documents.confirm(id, user.id);
    return this.requireInventory(this.prisma, id);
  }

  /**
   * Posting the adjustment (§22).
   *
   * Shortage comes off a named LOT when the count identified one, and off the
   * oldest available layer when it did not. The loss is valued at each
   * layer's own landed cost — the point of keeping LOT costs at all.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const decision = this.context.take();
    if (!decision) {
      throw new ConflictException(
        'Инвентаризация өз экраны аркылуу тастыкталат: POST /api/inventories/:id/confirm (§22)',
      );
    }

    const inventory = await this.requireInventory(tx, document.id);
    let shortageValue = ZERO;
    let excessValue = ZERO;
    const adjustments: Prisma.InputJsonValue[] = [];

    for (const line of inventory.inventory_lines) {
      if (line.diff_qty.isZero()) {
        continue;
      }

      if (line.diff_qty.isNegative()) {
        const short = line.diff_qty.abs();
        const cost = line.layer_id
          ? await this.takeFromLayer(tx, {
              layerId: line.layer_id,
              warehouseId: inventory.warehouse_id,
              qty: short,
              documentId: document.id,
            })
          : await this.takeFifo(tx, {
              productId: line.product_id,
              warehouseId: inventory.warehouse_id,
              qty: short,
              documentId: document.id,
            });

        shortageValue = shortageValue.plus(cost);
        adjustments.push({
          line_id: line.id,
          product_id: line.product_id,
          kind: 'SHORTAGE',
          qty: short.toFixed(2),
          layer_id: line.layer_id,
          value_kgs: cost.toFixed(2),
          responsible: line.responsible,
        });
        continue;
      }

      const unitCost = decision.excessCosts.get(line.id)!;
      if (unitCost.isNegative()) {
        throw new BadRequestException('Ашыкчанын наркы терс болбойт');
      }

      await this.stock.createLayer(tx, {
        productId: line.product_id,
        source: fifo_layer_source.ADJUSTMENT,
        sourceDocId: document.id,
        layerDate: document.business_date,
        unitCost,
        qty: line.diff_qty,
        warehouseId: inventory.warehouse_id,
        documentId: document.id,
        movementType: stock_movement_type.ADJUSTMENT_IN,
      });

      const value = line.diff_qty
        .times(unitCost)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      excessValue = excessValue.plus(value);
      adjustments.push({
        line_id: line.id,
        product_id: line.product_id,
        kind: 'EXCESS',
        qty: line.diff_qty.toFixed(2),
        unit_cost: unitCost.toFixed(4),
        value_kgs: value.toFixed(2),
        responsible: line.responsible,
      });
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'inventories',
        entityId: document.id,
        action: 'INVENTORY_ADJUSTED',
        newValue: {
          warehouse_id: inventory.warehouse_id,
          is_full: inventory.is_full,
          // §22: the shortage loss is its own line and stays out of the bonus
          // base; recording it separately here is what lets a report say so.
          shortage_value_kgs: shortageValue.toFixed(2),
          excess_value_kgs: excessValue.toFixed(2),
          in_bonus_base: false,
          adjustments,
        },
        reason: decision.reason,
      },
      tx,
    );
  }

  findMany(filter: { warehouseId?: string }): Promise<InventoryFull[]> {
    return this.repository.findMany(filter);
  }

  findOne(id: string, db: Db = this.prisma): Promise<InventoryFull> {
    return this.requireInventory(db, id);
  }

  /** Warehouses whose last full count is older than the schedule (§22). */
  async overdueWarehouses(
    on: Date = new Date(),
    everyDays = 30,
  ): Promise<{ warehouseId: string; code: string; lastCount: Date | null }[]> {
    const warehouses = await this.warehouses.findAll(false);
    const last = await this.repository.lastFullCount(this.prisma);
    const cutoff = new Date(on.getTime() - everyDays * 86_400_000);

    return warehouses
      .map((warehouse) => ({
        warehouseId: warehouse.id,
        code: warehouse.code,
        lastCount: last.get(warehouse.id) ?? null,
      }))
      .filter(
        (row) => row.lastCount === null || row.lastCount.getTime() < cutoff.getTime(),
      );
  }

  private async takeFromLayer(
    tx: Prisma.TransactionClient,
    params: {
      layerId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      documentId: string;
    },
  ): Promise<Prisma.Decimal> {
    const unitCost = await this.stock.removeFromWarehouse(tx, {
      layerId: params.layerId,
      warehouseId: params.warehouseId,
      qty: params.qty,
      documentId: params.documentId,
      movementType: stock_movement_type.ADJUSTMENT_OUT,
    });
    return params.qty
      .times(unitCost)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private async takeFifo(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      documentId: string;
    },
  ): Promise<Prisma.Decimal> {
    const plan = await this.stock.consumeFifo(tx, {
      productId: params.productId,
      warehouseId: params.warehouseId,
      qty: params.qty,
      documentId: params.documentId,
      movementType: stock_movement_type.ADJUSTMENT_OUT,
    });
    return plan.cogs;
  }

  private async requireInventory(db: Db, id: string): Promise<InventoryFull> {
    const inventory = await this.repository.findById(db, id);
    if (!inventory) {
      throw new NotFoundException('Инвентаризация табылган жок');
    }
    return inventory;
  }

  private async requireDraft(db: Db, id: string): Promise<InventoryFull> {
    const inventory = await this.requireInventory(db, id);
    if (inventory.documents.status !== 'DRAFT') {
      throw new ConflictException(
        'Тастыкталган инвентаризация өзгөртүлбөйт (§27.1)',
      );
    }
    return inventory;
  }
}
