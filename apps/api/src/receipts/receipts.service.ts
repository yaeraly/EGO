import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  Prisma,
  currency_code,
  doc_type,
  documents,
  expense_alloc_basis,
  rate_source,
  receipt_expenses,
  receipt_status,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { roundMoney, toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from '../purchases/purchases.service';
import {
  CostingExpense,
  CostingLine,
  CostingResult,
  computeLandedCost,
} from './landed-cost';
import { ReceiptRatesService, RateSuggestion } from './receipt-rates.service';
import { ReceiptProblem, validateReceipt } from './receipt-validation';
import { ReceiptConfirmService } from './receipt-confirm.service';
import {
  CreateExpenseDto,
  CreateReceiptDto,
  SetRatesDto,
  UpdateReceiptLinesDto,
} from './dto/receipt.dto';
import { ReceiptFull, ReceiptsRepository } from './receipts.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * Receipt (RCV) — §7, §8, §9, §18.1.
 *
 * The document that turns an order into stock. Nothing is stock until it is
 * confirmed, and confirming fixes a landed cost that never changes again
 * (§18.1.6.3–4) — so the work here is mostly refusing to confirm until the
 * figures are complete (§7, §9.8).
 *
 * Statuses: DRAFT → READY → RECEIVED → CLOSED (§7). The first two are
 * editable; confirming the document is what makes it RECEIVED.
 */
@Injectable()
export class ReceiptsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.RCV;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: ReceiptsRepository,
    private readonly purchases: PurchasesService,
    private readonly rates: ReceiptRatesService,
    private readonly confirmation: ReceiptConfirmService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  /**
   * Opens a receipt against a confirmed purchase.
   *
   * Every line starts with the ordered quantity as its received quantity:
   * that is what usually arrives, and the screen shows the two side by side
   * so a difference is a deliberate edit rather than an omission.
   */
  async create(dto: CreateReceiptDto, userId: string): Promise<documents> {
    const purchase = await this.purchases.findOne(dto.purchase_id);
    const purchaseDocument = await this.documents.findOne(dto.purchase_id);

    if (purchaseDocument.status !== 'CONFIRMED') {
      throw new ConflictException(
        `${purchaseDocument.doc_number} is ${purchaseDocument.status}: confirm the order before receiving it (§7)`,
      );
    }

    const existing = await this.repository.findByPurchase(
      this.prisma,
      dto.purchase_id,
    );
    const openReceipt = existing.find(
      (receipt) => receipt.rstatus !== receipt_status.CLOSED,
    );
    if (openReceipt) {
      throw new ConflictException(
        `This order already has an open receipt; finish or close it first (§7)`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.RCV,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        purchaseId: dto.purchase_id,
      });

      await this.repository.insertItems(
        tx,
        document.id,
        purchase.purchase_items.map((item, index) => ({
          productId: item.product_id,
          position: index,
          orderedQty: item.qty,
          receivedQty: item.qty,
        })),
      );

      return document;
    });
  }

  /** The quantities that actually arrived (§8.1). Editable until confirmed. */
  async updateLines(
    documentId: string,
    dto: UpdateReceiptLinesDto,
    userId: string,
  ): Promise<ReceiptFull> {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.requireEditable(tx, documentId, userId, 'UPDATE_LINES');

      for (const [index, line] of dto.lines.entries()) {
        const item = receipt.receipt_items.find(
          (row) => row.product_id === line.product_id,
        );
        if (!item) {
          throw new BadRequestException(
            `lines[${index}]: this product is not on the order`,
          );
        }

        const receivedQty = toDecimal(line.received_qty, `lines[${index}].received_qty`);
        const damagedQty = line.damaged_qty
          ? toDecimal(line.damaged_qty, `lines[${index}].damaged_qty`)
          : ZERO;

        if (receivedQty.isNegative()) {
          throw new BadRequestException(
            `lines[${index}].received_qty cannot be negative`,
          );
        }
        if (damagedQty.greaterThan(receivedQty)) {
          throw new BadRequestException(
            `lines[${index}]: damaged_qty cannot exceed received_qty (§8.4)`,
          );
        }

        await this.repository.updateItem(tx, item.id, { receivedQty, damagedQty });
      }

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'receipt_items',
          entityId: documentId,
          action: 'RECEIPT_LINES_UPDATED',
          newValue: {
            lines: dto.lines.map((line) => ({
              product_id: line.product_id,
              received_qty: line.received_qty,
              damaged_qty: line.damaged_qty ?? '0',
            })),
          },
        },
        tx,
      );

      return this.require(tx, documentId);
    });
  }

  /** Adds a direct expense with its own allocation basis (§5, §9.2). */
  async addExpense(
    documentId: string,
    dto: CreateExpenseDto,
    userId: string,
  ): Promise<receipt_expenses> {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.requireEditable(tx, documentId, userId, 'ADD_EXPENSE');

      const amount = toDecimal(dto.amount, 'amount');
      if (amount.isNegative()) {
        throw new BadRequestException('amount cannot be negative');
      }

      const basis = dto.alloc_basis ?? expense_alloc_basis.WEIGHT;
      const { rate, rateSource, kgsAmount } = await this.expenseInKgs(dto, amount);

      const expense = await this.repository.insertExpense(tx, {
        receiptId: documentId,
        etype: dto.etype,
        amount,
        currency: dto.currency,
        rate,
        rateSource,
        kgsAmount,
        allocBasis: basis,
        isPaid: dto.is_paid ?? false,
      });

      if (basis === expense_alloc_basis.MANUAL) {
        await this.storeManualAllocations(tx, receipt, expense.id, dto);
      }

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'receipt_expenses',
          entityId: expense.id,
          action: 'RECEIPT_EXPENSE_ADDED',
          newValue: {
            etype: dto.etype,
            amount: amount.toFixed(2),
            currency: dto.currency,
            rate: rate?.toString() ?? null,
            rate_source: rateSource,
            kgs_amount: kgsAmount.toFixed(2),
            alloc_basis: basis,
            is_paid: dto.is_paid ?? false,
          },
        },
        tx,
      );

      return expense;
    });
  }

  async removeExpense(
    documentId: string,
    expenseId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireEditable(tx, documentId, userId, 'REMOVE_EXPENSE');
      const expense = await this.repository.findExpense(tx, expenseId);
      if (!expense || expense.receipt_id !== documentId) {
        throw new NotFoundException('Expense not found on this receipt');
      }

      await this.repository.deleteExpense(tx, expenseId);
      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'receipt_expenses',
          entityId: expenseId,
          action: 'RECEIPT_EXPENSE_REMOVED',
          oldValue: {
            etype: expense.etype,
            kgs_amount: expense.kgs_amount.toFixed(2),
          },
        },
        tx,
      );
    });
  }

  /**
   * Fixes the exchange rates the receipt values goods at (§10.1).
   *
   * Called with nothing, it takes the system's suggestion — factual for what
   * has been paid, reference for what has not. A rate supplied by hand is
   * recorded as MANUAL, which is what §10.1 requires to be stored.
   */
  async setRates(
    documentId: string,
    dto: SetRatesDto,
    userId: string,
  ): Promise<ReceiptFull> {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.requireEditable(tx, documentId, userId, 'SET_RATES');

      const totalCny = this.totalOrderedCny(receipt);
      const suggested = await this.rates.suggestForPurchase(
        receipt.purchase_id,
        totalCny,
        tx,
      );

      const rateCny = dto.rate_cny
        ? toDecimal(dto.rate_cny, 'rate_cny')
        : suggested.rate;
      const rateCnySource = dto.rate_cny ? rate_source.MANUAL : suggested.source;

      if (rateCny.lessThanOrEqualTo(0)) {
        throw new BadRequestException('rate_cny must be greater than zero');
      }

      let rateUsd: Prisma.Decimal | null = receipt.rate_usd;
      let rateUsdSource: rate_source | null = receipt.rate_usd_source;
      if (dto.rate_usd) {
        rateUsd = toDecimal(dto.rate_usd, 'rate_usd');
        rateUsdSource = rate_source.MANUAL;
      }

      await this.repository.setRates(tx, documentId, {
        rateCny,
        rateCnySource,
        rateUsd,
        rateUsdSource,
      });

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'receipts',
          entityId: documentId,
          action: 'RECEIPT_RATES_SET',
          newValue: {
            rate_cny: rateCny.toString(),
            rate_cny_source: rateCnySource,
            rate_usd: rateUsd?.toString() ?? null,
            rate_usd_source: rateUsdSource,
            // §10.1 wants the derivation on record, not just the result.
            paid_cny: suggested.paid_amount,
            paid_rate: suggested.paid_rate,
            unpaid_cny: suggested.unpaid_amount,
            unpaid_rate: suggested.unpaid_rate,
          },
        },
        tx,
      );

      return this.require(tx, documentId);
    });
  }

  /** What the rates would be if taken from the system (§10.1). */
  async suggestRates(documentId: string): Promise<{
    cny: RateSuggestion;
    usd: RateSuggestion | null;
  }> {
    const receipt = await this.require(this.prisma, documentId);
    return {
      cny: await this.rates.suggestForPurchase(
        receipt.purchase_id,
        this.totalOrderedCny(receipt),
      ),
      usd: await this.rates.suggestUsd().catch(() => null),
    };
  }

  /** Everything standing between this receipt and RECEIVED (§7, §9.8). */
  async problems(documentId: string): Promise<ReceiptProblem[]> {
    return validateReceipt(await this.require(this.prisma, documentId));
  }

  /**
   * The landed cost this receipt would produce, without committing it.
   *
   * §2.8's preview screen: the OWNER checks each product's unit cost and that
   * Σ expenses equals Σ allocated, to the tiyin, before anything is fixed.
   */
  async preview(documentId: string): Promise<CostingResult> {
    const receipt = await this.require(this.prisma, documentId);
    const problems = validateReceipt(receipt);
    const blocking = problems.filter(
      (problem) => problem.code !== 'MISSING_RATE' && problem.code !== 'MISSING_RATE_SOURCE',
    );
    if (blocking.length > 0) {
      throw new ConflictException({
        message: 'The receipt is not complete enough to cost yet (§9.8)',
        problems: blocking,
      });
    }

    const rate =
      receipt.rate_cny ??
      (await this.rates.suggestForPurchase(
        receipt.purchase_id,
        this.totalOrderedCny(receipt),
      )).rate;

    return computeLandedCost({
      lines: costingLines(receipt),
      expenses: costingExpenses(receipt),
      rateCny: rate,
    });
  }

  /** DRAFT → READY (§7): the paperwork is done, the goods can be booked in. */
  async markReady(documentId: string, userId: string): Promise<ReceiptFull> {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.requireEditable(tx, documentId, userId, 'MARK_READY');
      if (receipt.rstatus === receipt_status.READY) {
        return receipt;
      }

      const problems = validateReceipt(receipt);
      if (problems.length > 0) {
        throw new ConflictException({
          message: 'The receipt cannot be marked ready yet (§7, §9.8)',
          problems,
        });
      }

      await this.repository.setStatus(tx, documentId, receipt_status.READY);
      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'receipts',
          entityId: documentId,
          action: 'RECEIPT_READY',
        },
        tx,
      );
      return this.require(tx, documentId);
    });
  }

  /**
   * Confirming the document is the receipt (§7).
   *
   * Delegated whole to ReceiptConfirmService: it is the single most
   * consequential transaction in the system, and it deserves to be read on
   * its own.
   */
  post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    return this.confirmation.confirm(tx, document, userId);
  }

  findOne(documentId: string, db: Db = this.prisma): Promise<ReceiptFull> {
    return this.require(db, documentId);
  }

  findMany(filter: { purchaseId?: string; status?: receipt_status }) {
    return this.repository.findMany(filter);
  }

  private totalOrderedCny(receipt: ReceiptFull): Prisma.Decimal {
    return receipt.purchases.purchase_items.reduce(
      (sum, line) => sum.plus(line.qty.times(line.price_cny)),
      ZERO,
    );
  }

  /**
   * Converts an expense to som (§10.1).
   *
   * An expense already in som needs no rate; anything else must state the
   * rate used and where it came from, because that is what the receipt has
   * to store.
   */
  private async expenseInKgs(
    dto: CreateExpenseDto,
    amount: Prisma.Decimal,
  ): Promise<{
    rate: Prisma.Decimal | null;
    rateSource: rate_source | null;
    kgsAmount: Prisma.Decimal;
  }> {
    if (dto.currency === currency_code.KGS) {
      return { rate: null, rateSource: null, kgsAmount: amount };
    }

    if (dto.rate) {
      const rate = toDecimal(dto.rate, 'rate');
      if (rate.lessThanOrEqualTo(0)) {
        throw new BadRequestException('rate must be greater than zero');
      }
      return {
        rate,
        rateSource: dto.rate_source ?? rate_source.MANUAL,
        kgsAmount: roundMoney(amount.times(rate)),
      };
    }

    const suggestion =
      dto.currency === currency_code.USD
        ? await this.rates.suggestUsd()
        : await this.rates.suggestForPurchase(
            // A CNY expense with no rate given falls back to the reference
            // rate, the same source §10.1 gives for an unpaid portion.
            '00000000-0000-0000-0000-000000000000',
            ZERO,
          );

    return {
      rate: suggestion.rate,
      rateSource: suggestion.source,
      kgsAmount: roundMoney(amount.times(suggestion.rate)),
    };
  }

  private async storeManualAllocations(
    tx: Prisma.TransactionClient,
    receipt: ReceiptFull,
    expenseId: string,
    dto: CreateExpenseDto,
  ): Promise<void> {
    const rows = (dto.manual_allocations ?? []).map((row, index) => {
      const item = receipt.receipt_items.find(
        (line) => line.id === row.receipt_item_id,
      );
      if (!item) {
        throw new BadRequestException(
          `manual_allocations[${index}]: that line is not on this receipt`,
        );
      }
      return {
        receiptItemId: row.receipt_item_id,
        amountKgs: toDecimal(row.amount_kgs, `manual_allocations[${index}].amount_kgs`),
      };
    });

    await this.repository.replaceManualAllocations(tx, expenseId, rows);
  }

  /**
   * The receipt, if it can still be edited (§27.1, §7).
   *
   * A RECEIVED receipt has fixed a landed cost that FIFO layers now carry;
   * changing a quantity or an expense afterwards would silently restate every
   * cost derived from it, so it is refused and the rejection is audited.
   */
  private async requireEditable(
    tx: Prisma.TransactionClient,
    documentId: string,
    userId: string,
    action: string,
  ): Promise<ReceiptFull> {
    const receipt = await this.require(tx, documentId);
    const document = await this.documents.findOne(documentId);

    if (
      receipt.rstatus === receipt_status.RECEIVED ||
      receipt.rstatus === receipt_status.CLOSED ||
      document.status !== 'DRAFT'
    ) {
      // Written outside the transaction the 409 rolls back, so the attempt
      // survives in the Audit Log.
      await this.audit.log({
        userId,
        documentId,
        entity: 'receipts',
        entityId: documentId,
        action: 'RECEIPT_UPDATE_REJECTED',
        reason: `${action} refused: receipt is ${receipt.rstatus}, document is ${document.status}`,
      });
      throw new ConflictException(
        `${document.doc_number} is ${receipt.rstatus}: a confirmed receipt does not change; correct it with a COR (§27.1, §18.1.6.3)`,
      );
    }

    return receipt;
  }

  private async require(db: Db, documentId: string): Promise<ReceiptFull> {
    const receipt = await this.repository.findById(db, documentId);
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }
    return receipt;
  }
}

/** The receipt's lines, in the shape the costing reads. */
export function costingLines(receipt: ReceiptFull): CostingLine[] {
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

export function costingExpenses(receipt: ReceiptFull): CostingExpense[] {
  return receipt.receipt_expenses.map((expense) => ({
    id: expense.id,
    etype: expense.etype,
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
