import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  discrepancy_type,
  doc_type,
  documents,
  fifo_layer_source,
  purchase_status,
  receipt_status,
  stock_movement_type,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { roundMoney } from '../common/decimal';
import { DocumentsService } from '../documents/documents.service';
import { splitAgainstDebt, SupplierLedgerService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasePayableService } from '../purchases/purchase-payable.service';
import { PurchasesRepository } from '../purchases/purchases.repository';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service';
import { CostedLine, computeLandedCost } from './landed-cost';
import { validateReceipt } from './receipt-validation';
import { ReceiptFull, ReceiptsRepository } from './receipts.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * Confirming a receipt — the most consequential transaction in the system.
 *
 * One transaction does all of this, or none of it:
 *
 *   1. the figures are checked one last time (§7, §9.8);
 *   2. every direct expense is allocated across what actually arrived
 *      (§9.3–9.9), to the tiyin;
 *   3. a LOT and its items are written with the resulting unit landed cost
 *      (§9.7, §18.1) — fixed from this moment on (§18.1.6.3–4);
 *   4. a FIFO layer per line enters stock: MAIN for the good units, DEFECT
 *      for the damaged ones, both at the same cost (§8.4, §12-А.6);
 *   5. any advance the supplier holds is put against this order's payable
 *      (§4.3), with its exchange result (§10.2);
 *   6. ordered is compared with received and a DIF is raised for every
 *      difference (§8), with the financial consequence §8.2–8.3 requires.
 *
 * Order matters: nothing enters stock before its cost is known, and no
 * discrepancy is settled before the goods it is about are booked.
 */
@Injectable()
export class ReceiptConfirmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ReceiptsRepository,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly ledger: SupplierLedgerService,
    private readonly purchases: PurchasesRepository,
    private readonly purchasePayable: PurchasePayableService,
    private readonly discrepancies: DiscrepanciesService,
    private readonly audit: AuditService,
  ) {}

  async confirm(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const locked = await this.repository.lock(tx, document.id);
    if (!locked) {
      throw new NotFoundException(
        `Receipt body missing for ${document.doc_number}`,
      );
    }
    if (
      locked.rstatus === receipt_status.RECEIVED ||
      locked.rstatus === receipt_status.CLOSED
    ) {
      throw new ConflictException(
        `${document.doc_number} is already ${locked.rstatus}`,
      );
    }

    const receipt = await this.require(tx, document.id);

    // 1. §7, §9.8 — the last gate before a cost becomes permanent.
    const problems = validateReceipt(receipt);
    if (problems.length > 0) {
      throw new ConflictException({
        message: 'The receipt cannot be confirmed yet (§7, §9.8)',
        problems,
      });
    }

    // 2, 3. §9.3–9.9, §9.7 — allocation and the unit landed cost.
    const costing = computeLandedCost({
      lines: costingLinesOf(receipt),
      expenses: costingExpensesOf(receipt),
      rateCny: receipt.rate_cny!,
    });

    const lot = await this.createLot(tx, document, receipt, costing.totalWeightKg, costing.totalLandedCostKgs);
    const lotItemByLine = await this.createLotItems(tx, lot.document_id, receipt, costing.lines);
    await this.recordAllocations(tx, receipt, costing.lines, lotItemByLine);

    // 4. §18, §8.4, §12-А.6 — stock, split between MAIN and DEFECT.
    await this.createLayers(tx, document, receipt, costing.lines, lotItemByLine);

    // 5. §6.1 — goods cannot arrive without having left the supplier, so the
    // debt for them is due by now even if nobody moved the stage along.
    await this.purchasePayable.recognise(
      tx,
      receipt.purchase_id,
      userId,
      'RECEIPT',
    );

    // 6. §4.3, §10.2 — an advance the supplier holds goes against this order.
    const prepayment = await this.applyPrepayment(tx, document, receipt);

    // 7. §8 — ordered against received, and what that means financially.
    const discrepancies = await this.discrepancies.raiseForReceipt(tx, {
      receipt,
      receiptDocument: document,
      costedLines: costing.lines,
      userId,
    });

    await this.repository.setStatus(tx, document.id, receipt_status.RECEIVED);
    // §6, stage 15 — the batch itself has now been received. Without this the
    // shipment would stay "in transit" on the Balance while its goods are
    // already in stock, and be counted twice.
    await this.purchases.setLogisticsStatus(
      tx,
      receipt.purchase_id,
      purchase_status.RECEIVED,
    );

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'receipts',
        entityId: document.id,
        action: 'RECEIPT_CONFIRMED',
        newValue: {
          lot_id: lot.document_id,
          rate_cny: receipt.rate_cny!.toString(),
          rate_cny_source: receipt.rate_cny_source,
          total_weight_kg: costing.totalWeightKg.toFixed(3),
          total_landed_cost_kgs: costing.totalLandedCostKgs.toFixed(2),
          lines: costing.lines.map((line) => ({
            sku: line.sku,
            ordered_qty: line.orderedQty.toFixed(2),
            received_qty: line.receivedQty.toFixed(2),
            damaged_qty: line.damagedQty.toFixed(2),
            purchase_cost_kgs: line.purchaseCostKgs.toFixed(2),
            allocated_kgs: line.allocatedTotalKgs.toFixed(2),
            unit_landed_cost: line.unitLandedCost.toFixed(4),
          })),
          prepayment_applied_cny: prepayment.appliedCny.toFixed(2),
          prepayment_fx_kgs: prepayment.fxGainLossKgs.toFixed(2),
          discrepancies: discrepancies.length,
        },
      },
      tx,
    );
  }

  /** The LOT: a batch of goods physically received, with its cost (§18.1). */
  private async createLot(
    tx: Prisma.TransactionClient,
    document: documents,
    receipt: ReceiptFull,
    totalWeight: Prisma.Decimal,
    totalLandedCost: Prisma.Decimal,
  ) {
    // The LOT is its own document (§18.1) so its number can be quoted on a
    // shelf label and traced back through the FIFO layers.
    const lotDocument = await this.documents.create(tx, {
      docType: doc_type.LOT,
      businessDate: document.business_date,
      userId: document.created_by,
      comment: `Приход ${document.doc_number}`,
    });
    await this.documents.markConfirmedWithoutPosting(tx, lotDocument.id);

    return tx.lots.create({
      data: {
        document_id: lotDocument.id,
        receipt_id: receipt.document_id,
        purchase_id: receipt.purchase_id,
        total_weight_kg: totalWeight,
        total_landed_cost_kgs: totalLandedCost,
      },
    });
  }

  /**
   * LOT items (§18.1.2).
   *
   * A line that received nothing still gets an item: §8 needs the ordered and
   * received quantities on record for the discrepancy, and §18.1.6.2 wants
   * every received good tied to a LOT item. It simply creates no FIFO layer.
   */
  private async createLotItems(
    tx: Prisma.TransactionClient,
    lotId: string,
    receipt: ReceiptFull,
    lines: CostedLine[],
  ): Promise<Map<string, string>> {
    const byLine = new Map<string, string>();

    for (const line of lines) {
      const purchaseLine = receipt.purchases.purchase_items.find(
        (row) => row.product_id === line.productId,
      );

      const item = await tx.lot_items.create({
        data: {
          lot_id: lotId,
          product_id: line.productId,
          ordered_qty: line.orderedQty,
          received_qty: line.receivedQty,
          damaged_qty: line.damagedQty,
          unit_weight_kg: line.unitWeightKg,
          purchase_price_cny: purchaseLine?.price_cny ?? ZERO,
          purchase_cost_kgs: line.purchaseCostKgs,
          unit_landed_cost: line.unitLandedCost,
        },
      });
      byLine.set(line.lineId, item.id);
    }

    return byLine;
  }

  /** Every split, on record, so a landed cost can be explained (§9.6, §9.9). */
  private async recordAllocations(
    tx: Prisma.TransactionClient,
    receipt: ReceiptFull,
    lines: CostedLine[],
    lotItemByLine: Map<string, string>,
  ): Promise<void> {
    const rows: { expense_id: string; lot_item_id: string; amount_kgs: Prisma.Decimal }[] = [];

    for (const line of lines) {
      const lotItemId = lotItemByLine.get(line.lineId)!;
      for (const [expenseId, amount] of line.allocatedByExpense) {
        rows.push({ expense_id: expenseId, lot_item_id: lotItemId, amount_kgs: amount });
      }
    }

    if (rows.length > 0) {
      await tx.expense_allocations.createMany({ data: rows });
    }

    // §9.9 step 6, proved against what was actually written rather than what
    // was computed: Σ allocated must equal each expense to the tiyin.
    for (const expense of receipt.receipt_expenses) {
      const allocated = rows
        .filter((row) => row.expense_id === expense.id)
        .reduce((sum, row) => sum.plus(row.amount_kgs), ZERO);
      if (!allocated.equals(expense.kgs_amount)) {
        throw new ConflictException(
          `${expense.etype}: ${allocated.toFixed(2)} allocated against ${expense.kgs_amount.toFixed(2)} — they must be equal (§9.9)`,
        );
      }
    }
  }

  /**
   * Stock, at last (§18, §8.4).
   *
   * One FIFO layer per line, dated to the receipt's business date, carrying
   * the unit landed cost. Damaged units share that layer and that cost but
   * land in DEFECT, where they are outside Available Stock (§12-А.6) — they
   * were paid for and shipped like the rest, so pretending they cost less
   * would misstate both the loss and the stock value.
   */
  private async createLayers(
    tx: Prisma.TransactionClient,
    document: documents,
    receipt: ReceiptFull,
    lines: CostedLine[],
    lotItemByLine: Map<string, string>,
  ): Promise<void> {
    const main = await this.warehouses.main();
    const defect = lines.some((line) => line.damagedQty.greaterThan(0))
      ? await this.warehouses.defect()
      : null;

    for (const line of lines) {
      if (line.receivedQty.lessThanOrEqualTo(0)) {
        continue;
      }

      const goodQty = line.receivedQty.minus(line.damagedQty);
      const lotItemId = lotItemByLine.get(line.lineId)!;

      // The layer is created wherever the first units go, then the rest is
      // added — one layer, one cost, two warehouses.
      const firstWarehouse = goodQty.greaterThan(0) ? main.id : defect!.id;
      const firstQty = goodQty.greaterThan(0) ? goodQty : line.damagedQty;

      const layer = await this.stock.createLayer(tx, {
        productId: line.productId,
        source: fifo_layer_source.PURCHASE,
        lotItemId,
        sourceDocId: document.id,
        layerDate: document.business_date,
        unitCost: line.unitLandedCost,
        qty: firstQty,
        warehouseId: firstWarehouse,
        documentId: document.id,
        movementType: stock_movement_type.RECEIPT_IN,
      });

      if (goodQty.greaterThan(0) && line.damagedQty.greaterThan(0)) {
        await this.stock.addToWarehouse(tx, {
          layerId: layer.id,
          warehouseId: defect!.id,
          qty: line.damagedQty,
          documentId: document.id,
          movementType: stock_movement_type.RECEIPT_IN,
        });
      }
    }
  }

  /**
   * Puts any advance the supplier holds against this order (§4.3).
   *
   * The advance was bought at a known cost and the payable was recognised at
   * the reference rate; the gap is the exchange result (§10.2), which is a
   * financial figure and never touches a landed cost (§18.1.6.4).
   */
  private async applyPrepayment(
    tx: Prisma.TransactionClient,
    document: documents,
    receipt: ReceiptFull,
  ): Promise<{ appliedCny: Prisma.Decimal; fxGainLossKgs: Prisma.Decimal }> {
    const supplierId = receipt.purchases.supplier_id;

    const advance = await this.ledger.openPrepayment(tx, supplierId);
    if (advance.amount.lessThanOrEqualTo(0)) {
      return { appliedCny: ZERO, fxGainLossKgs: ZERO };
    }

    // openDebt already reports what is owed as a positive amount, with the
    // KGS it was recognised at alongside it.
    const debt = await this.ledger.openDebt(tx, supplierId);
    const owed = Prisma.Decimal.max(debt.amount, ZERO);
    if (owed.lessThanOrEqualTo(0)) {
      return { appliedCny: ZERO, fxGainLossKgs: ZERO };
    }

    const applied = Prisma.Decimal.min(advance.amount, owed);

    // What that slice of the advance actually cost, and what the debt it
    // settles was booked at.
    const actualKgs = roundMoney(
      advance.kgsValue.times(applied).dividedBy(advance.amount),
    );
    const recognisedKgs = roundMoney(
      debt.kgsValue.times(applied).dividedBy(owed),
    );

    await this.ledger.applyPrepayment(tx, {
      supplierId,
      documentId: document.id,
      amountCny: applied,
      actualKgs,
      recognisedKgs,
    });

    return {
      appliedCny: applied,
      fxGainLossKgs: recognisedKgs.minus(actualKgs),
    };
  }

  private async require(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<ReceiptFull> {
    const receipt = await this.repository.findById(tx, documentId);
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }
    return receipt;
  }
}

/** Duplicated from ReceiptsService to keep the confirm path free of cycles. */
function costingLinesOf(receipt: ReceiptFull) {
  return receipt.receipt_items.map((item) => {
    const purchaseLine = receipt.purchases.purchase_items.find(
      (line) => line.product_id === item.product_id,
    );
    return {
      id: item.id,
      productId: item.product_id,
      sku: item.products.sku,
      name: item.products.name,
      orderedQty: item.ordered_qty,
      receivedQty: item.received_qty,
      damagedQty: item.damaged_qty,
      unitWeightKg: item.products.weight_kg,
      unitVolume:
        item.products.chargeable_weight_kg ?? item.products.volume_m3 ?? null,
      priceCny: purchaseLine?.price_cny ?? ZERO,
    };
  });
}

function costingExpensesOf(receipt: ReceiptFull) {
  return receipt.receipt_expenses.map((expense) => ({
    id: expense.id,
    etype: expense.etype as string,
    amountKgs: expense.kgs_amount,
    basis: expense.alloc_basis,
    manualByLine: new Map(
      expense.receipt_expense_manual_allocations.map((row) => [
        row.receipt_item_id,
        row.amount_kgs,
      ]),
    ),
  }));
}

export { discrepancy_type };
