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
  return_condition,
  stock_movement_type,
  user_role,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { BonusesService } from '../bonuses/bonuses.service';
import { AuthService } from '../auth/auth.service';
import { CategoriesService } from '../categories/categories.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { CreditRepository } from '../credit/credit.repository';
import { allocatePayment } from '../customer-payments/allocation';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesRepository } from '../sales/sales.repository';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  ConfirmReturnDto,
  CreateReturnDto,
} from './dto/return.dto';
import { ReturnFull, ReturnsRepository } from './returns.repository';

const ZERO = new Prisma.Decimal(0);

/** What a confirmation carries from the controller into the transaction. */
@Injectable()
export class ReturnConfirmContext {
  private current: {
    refunds: { accountId: string; amount: Prisma.Decimal }[];
    sourceOverrideReason: string | null;
    warrantyExceptionReason: string | null;
    role: user_role;
  } | null = null;

  set(value: NonNullable<ReturnConfirmContext['current']>): void {
    this.current = value;
  }

  take(): ReturnConfirmContext['current'] {
    const value = this.current;
    this.current = null;
    return value;
  }
}

/**
 * Return (RET) — §35.
 *
 * A return is not "put it back on the shelf". It is the reverse of one
 * particular sale, and §35 has it correct six things at once: stock, cost,
 * revenue, the customer's debt, the till, and the reports. Two rules shape
 * everything here:
 *
 *   §35.1.1 — a return always names the sale it reverses, Walk-in included.
 *   §18.0   — the goods come back at the cost they left at, as a *new* layer
 *             dated today. The old LOT is not refilled and today's cost is not
 *             borrowed.
 */
@Injectable()
export class ReturnsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.RET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: ReturnsRepository,
    private readonly sales: SalesRepository,
    private readonly credit: CreditRepository,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly auth: AuthService,
    private readonly bonuses: BonusesService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
    private readonly context: ReturnConfirmContext,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateReturnDto, userId: string): Promise<documents> {
    const sale = await this.sales.findById(this.prisma, dto.original_sale);
    if (!sale) {
      throw new NotFoundException('Баштапкы сатуу табылган жок (§35.1)');
    }
    const saleDocument = await this.documents.findOne(dto.original_sale);
    if (saleDocument.status !== 'CONFIRMED') {
      throw new ConflictException(
        'Тастыкталбаган сатуудан возврат болбойт (§35.1)',
      );
    }

    const businessDate = resolveBusinessDate(dto.business_date);

    const lines: {
      saleItemId: string;
      qty: Prisma.Decimal;
      condition: return_condition;
      originalPrice: Prisma.Decimal;
      originalUnitCost: Prisma.Decimal;
      warrantyOk: boolean | null;
    }[] = [];
    let total = ZERO;

    for (const [index, item] of dto.items.entries()) {
      const saleItem = sale.sale_items.find((row) => row.id === item.sale_item_id);
      if (!saleItem) {
        throw new NotFoundException(
          `items[${index}]: бул сап баштапкы сатууда жок (§35.1)`,
        );
      }

      const qty = toDecimal(item.qty, `items[${index}].qty`);
      if (qty.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException(`items[${index}].qty оң болушу керек`);
      }

      // §35.7 — never more than was sold, counting what already came back.
      const returnable = saleItem.qty.minus(saleItem.returned_qty);
      if (qty.greaterThan(returnable)) {
        throw new ConflictException(
          `${saleItem.products.sku}: сатылган ${saleItem.qty.toFixed(2)}, ` +
            `кайтарылган ${saleItem.returned_qty.toFixed(2)} — ` +
            `кайтарууга ${returnable.toFixed(2)} гана калды (§35.7)`,
        );
      }

      // §18.0 — the unit cost this line left at, not today's.
      const unitCost = saleItem.qty.isZero()
        ? ZERO
        : saleItem.fifo_cogs
            .dividedBy(saleItem.qty)
            .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

      const warrantyOk =
        item.condition === return_condition.DEFECT
          ? await this.withinWarranty(
              saleItem.product_id,
              saleDocument.business_date,
              businessDate,
            )
          : null;

      lines.push({
        saleItemId: saleItem.id,
        qty,
        condition: item.condition,
        originalPrice: saleItem.final_price,
        originalUnitCost: unitCost,
        warrantyOk,
      });

      total = total.plus(
        saleItem.final_price
          .times(qty)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.RET,
        businessDate,
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        originalSale: sale.document_id,
        customerId: sale.customer_id,
        totalReturnAmount: total,
        reason: dto.reason.trim(),
      });
      await this.repository.insertItems(tx, document.id, lines);

      return document;
    });
  }

  /**
   * Confirming a return (§35.2.10).
   *
   * A PIN every time, because money leaves. §36-А.2 adds a second gate for a
   * defective item whose warranty has run out: an ordinary salesperson cannot
   * confirm it at all, and the OWNER only with a stated reason.
   */
  async confirm(
    id: string,
    dto: ConfirmReturnDto,
    user: { id: string; role: user_role },
    ip?: string,
  ): Promise<ReturnFull> {
    const { valid } = await this.auth.verifyPin(user.id, dto.pin, {
      ip: ip ?? null,
      device: `return:${id}`,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }

    const record = await this.requireReturn(this.prisma, id);
    const expired = record.return_items.filter(
      (item) => item.warranty_ok === false,
    );
    if (expired.length > 0) {
      if (user.role !== user_role.OWNER) {
        throw new ForbiddenException(
          'Кепилдик мөөнөтү өткөн брак возвратты ЭЭСИ гана тастыктайт (§36-А.2)',
        );
      }
      if (!dto.warranty_exception_reason?.trim()) {
        throw new UnprocessableEntityException({
          message:
            'Кепилдик мөөнөтү өтүп кеткен — өзгөчө возврат үчүн себеп милдеттүү (§36-А.2)',
          code: 'WARRANTY_EXPIRED',
          items: expired.map((item) => item.id),
        });
      }
    }

    this.context.set({
      refunds: (dto.refunds ?? []).map((line) => ({
        accountId: line.account_id,
        amount: toDecimal(line.amount, 'refunds[].amount'),
      })),
      sourceOverrideReason: dto.source_override_reason?.trim() ?? null,
      warrantyExceptionReason: dto.warranty_exception_reason?.trim() ?? null,
      role: user.role,
    });

    await this.documents.confirm(id, user.id);
    return this.requireReturn(this.prisma, id);
  }

  /** Stock in, money out, debt down — one transaction (§35.8). */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const decision = this.context.take();
    if (!decision) {
      throw new ConflictException(
        'Возврат өз экраны аркылуу тастыкталат: POST /api/returns/:id/confirm (§35)',
      );
    }

    const record = await this.requireReturn(tx, document.id);
    const main = await this.warehouses.main();
    const defect = await this.warehouses.defect();

    // §35.7 again, this time with the rows locked: two returns of the last
    // unit must not both pass.
    const sold = await this.repository.lockReturnedQty(
      tx,
      record.return_items.map((item) => item.sale_item_id),
    );

    const restocked: Prisma.InputJsonValue[] = [];
    let cogsReversed = ZERO;

    for (const item of record.return_items) {
      const line = sold.get(item.sale_item_id);
      if (!line) {
        throw new NotFoundException('Баштапкы сатуунун сабы табылган жок');
      }
      const returnable = line.qty.minus(line.returned);
      if (item.qty.greaterThan(returnable)) {
        throw new ConflictException(
          `Кайтарууга ${returnable.toFixed(2)} гана калды (§35.7)`,
        );
      }

      // §18.0 — a new layer at the original cost, dated today, in the
      // warehouse the condition dictates (§35.3, §42.12).
      const layer = await this.stock.createLayer(tx, {
        productId: (await this.saleItemProduct(tx, item.sale_item_id)),
        source: fifo_layer_source.RETURN,
        sourceDocId: document.id,
        layerDate: document.business_date,
        unitCost: item.original_unit_cost,
        qty: item.qty,
        warehouseId:
          item.condition === return_condition.RESALABLE ? main.id : defect.id,
        documentId: document.id,
        movementType: stock_movement_type.RETURN_IN,
      });

      await this.repository.setLayer(tx, item.id, layer.id);
      await this.repository.addReturnedQty(tx, item.sale_item_id, item.qty);

      if (item.warranty_ok === false && decision.warrantyExceptionReason) {
        await this.repository.setWarrantyException(
          tx,
          item.id,
          decision.warrantyExceptionReason,
        );
      }

      const lineCogs = item.qty
        .times(item.original_unit_cost)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      cogsReversed = cogsReversed.plus(lineCogs);

      restocked.push({
        return_item_id: item.id,
        sale_item_id: item.sale_item_id,
        qty: item.qty.toFixed(2),
        condition: item.condition,
        warehouse_id:
          item.condition === return_condition.RESALABLE ? main.id : defect.id,
        unit_cost: item.original_unit_cost.toFixed(4),
        new_layer_id: layer.id,
        warranty_ok: item.warranty_ok,
      });
    }

    // §35.4 — the customer's open debt is settled before any cash leaves.
    const debts = await this.credit.lockOpenDebts(tx, record.customer_id);
    const offset = allocatePayment({
      amount: record.total_return_amount,
      debts: debts.map((debt) => ({
        saleId: debt.sale_id,
        docNumber: debt.doc_number,
        outstanding: debt.outstanding_amount,
      })),
    });

    for (const line of offset.lines) {
      await this.sales.applyAllocation(tx, line.saleId, line.amount);
      // §23.2 — settling a debt this way makes that sale's bonus payable too.
      await this.bonuses.reassess(tx, line.saleId);
    }

    // §23.4 — the margin on returned goods is taken back with them.
    await this.bonuses.reverseForReturn(tx, {
      saleId: record.original_sale,
      returnId: document.id,
      lines: record.return_items.map((item) => ({
        qty: item.qty,
        unitPrice: item.original_price,
        unitCost: item.original_unit_cost,
      })),
      userId,
    });

    const debtOffset = record.total_return_amount.minus(offset.overpayment);
    const cash = offset.overpayment;

    const requested = decision.refunds.reduce(
      (sum, line) => sum.plus(line.amount),
      ZERO,
    );
    if (!requested.equals(cash)) {
      throw new UnprocessableEntityException({
        message:
          `Карыз жабылгандан кийин колго ${cash.toFixed(2)} сом кайтарылат ` +
          `(карызга ${debtOffset.toFixed(2)} эсептелди) — берилген саптар ${requested.toFixed(2)} (§35.4)`,
        code: 'REFUND_AMOUNT_MISMATCH',
        debt_offset: debtOffset.toFixed(2),
        cash_refund: cash.toFixed(2),
      });
    }

    // §35.5 — which account each part leaves from is documented, and a source
    // other than the sale's own needs a stated reason.
    const paidFrom = new Set(
      (
        await tx.sale_payment_lines.findMany({
          where: { sale_id: record.original_sale },
          select: { account_id: true },
        })
      ).map((line) => line.account_id),
    );

    for (const line of decision.refunds) {
      if (line.amount.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException('Кайтаруу суммасы оң болушу керек');
      }
      const isOriginal = paidFrom.has(line.accountId);
      if (!isOriginal && !decision.sourceOverrideReason) {
        throw new UnprocessableEntityException({
          message:
            'Акча баштапкы төлөм эсебинен эмес, башка эсептен кайтарылып жатат — себеп милдеттүү (§35.5)',
          code: 'REFUND_SOURCE_OVERRIDE_REASON_REQUIRED',
        });
      }

      const { account, balance } = await this.accounts.lockBalance(
        tx,
        line.accountId,
      );
      // §35.6 — an account that cannot cover it says so; the cashier splits
      // the refund or uses another account rather than going negative.
      await this.accounts.postMovement(tx, {
        accountId: line.accountId,
        documentId: document.id,
        amount: line.amount.negated(),
        kgsValue: null,
        currentBalance: balance,
        accountName: account.name,
      });

      await this.repository.insertRefundLines(tx, document.id, [
        {
          accountId: line.accountId,
          amount: line.amount,
          sourceOverrideReason: isOriginal
            ? null
            : decision.sourceOverrideReason,
        },
      ]);
    }

    await this.repository.setSettlement(tx, document.id, {
      debtOffset,
      cashRefund: cash,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'returns',
        entityId: document.id,
        action: 'RETURN_CONFIRMED',
        newValue: {
          original_sale: record.original_sale,
          customer_id: record.customer_id,
          total_return_amount: record.total_return_amount.toFixed(2),
          // §35.8 — the figures the reports have to move by.
          revenue_reversed: record.total_return_amount.toFixed(2),
          cogs_reversed: cogsReversed.toFixed(2),
          debt_offset: debtOffset.toFixed(2),
          cash_refund: cash.toFixed(2),
          restocked,
          warranty_exception_reason: decision.warrantyExceptionReason,
        },
        reason: record.reason,
      },
      tx,
    );
  }

  /**
   * What confirming would settle, without settling it (§35.4).
   *
   * The screen has to tell the cashier how much cash to count out before they
   * type a PIN, and §35.4 decides that: the open debt first, the remainder in
   * cash. Read-only, and recomputed for real inside the confirming
   * transaction — this is the preview, not the decision.
   */
  async settlement(
    id: string,
  ): Promise<{ debt_offset: string; cash_refund: string }> {
    const record = await this.requireReturn(this.prisma, id);
    const debts = await this.credit.openDebts(this.prisma, record.customer_id);

    const offset = allocatePayment({
      amount: record.total_return_amount,
      debts: debts.map((debt) => ({
        saleId: debt.sale_id,
        docNumber: debt.doc_number,
        outstanding: debt.outstanding_amount,
      })),
    });

    return {
      debt_offset: record.total_return_amount
        .minus(offset.overpayment)
        .toFixed(2),
      cash_refund: offset.overpayment.toFixed(2),
    };
  }

  findMany(filter: {
    customerId?: string;
    originalSale?: string;
  }): Promise<ReturnFull[]> {
    return this.repository.findMany(filter);
  }

  findOne(id: string, db: Db = this.prisma): Promise<ReturnFull> {
    return this.requireReturn(db, id);
  }

  /**
   * §36-А.2 — was the return made inside the warranty term?
   *
   * The term is the product's own, or its category's when it sets none
   * (§12-Б.7), and it runs from the day the sale was confirmed (§36-А.1).
   */
  private async withinWarranty(
    productId: string,
    soldOn: Date,
    returnedOn: Date,
  ): Promise<boolean> {
    const product = await this.prisma.products.findUniqueOrThrow({
      where: { id: productId },
      select: { warranty_days: true, category_id: true },
    });
    const days = await this.categories.warrantyDays(
      product.warranty_days,
      product.category_id,
    );

    // §36-А.2 states the test in dates — "Return Date ≤ Sale Date + Warranty
    // Days" — so it is compared in dates. A same-day defect on a product with
    // no warranty term is inside it, not a day late.
    const expires = new Date(midnight(soldOn).getTime() + days * 86_400_000);
    return midnight(returnedOn).getTime() <= expires.getTime();
  }

  private async saleItemProduct(
    tx: Prisma.TransactionClient,
    saleItemId: string,
  ): Promise<string> {
    const item = await tx.sale_items.findUniqueOrThrow({
      where: { id: saleItemId },
      select: { product_id: true },
    });
    return item.product_id;
  }

  private async requireReturn(db: Db, id: string): Promise<ReturnFull> {
    const record = await this.repository.findById(db, id);
    if (!record) {
      throw new NotFoundException('Возврат табылган жок');
    }
    return record;
  }
}

/** The date part of a timestamp, in UTC — how the document stores dates. */
function midnight(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}
