import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  Prisma,
  approval_status,
  debt_status,
  doc_type,
  documents,
  user_role,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { DayCloseBlocker, DayCloseBlockerRegistry, DayCloseBlockerSource } from '../business-days/day-close-blockers';
import { Db } from '../common/db';
import { roundMoney, toDecimal, toOptionalDecimal } from '../common/decimal';
import { CreditService } from '../credit/credit.service';
import { CustomersService } from '../customers/customers.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ReservationsService } from '../reservations/reservations.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  ApproveDiscountDto,
  ConfirmSaleDto,
  CreateSaleDto,
} from './dto/sale.dto';
import { resolvePayments } from './sale-payments';
import {
  DiscountFacts,
  PricedLine,
  SaleBlock,
  discountFacts,
  lossAmount,
  saleBlocks,
} from './sale-rules';
import { SaleFull, SalesRepository } from './sales.repository';
import { SaleConfirmService } from './sale-confirm.service';

const ZERO = new Prisma.Decimal(0);

/** What the sale screen and the confirm both work from. */
export interface SaleAssessment {
  sale_id: string;
  doc_number: string;
  status: string;
  is_loss_sale: boolean;
  customer: { id: string; name: string; is_walk_in: boolean };
  lines: {
    product_id: string;
    sku: string;
    name: string;
    qty: string;
    auto_price: string;
    final_price: string;
    line_total: string;
    /** Only when the viewer may see costs. */
    fifo_cogs: string | null;
  }[];
  totals: {
    auto_total: string;
    total: string;
    discount_amount: string;
    discount_pct: string;
    /** Null when the viewer may not see costs (§13.4 blocks either way). */
    fifo_cogs: string | null;
    margin: string | null;
  };
  payment: { paid: string; change: string; outstanding: string };
  blocks: SaleBlock[];
  approval_status: approval_status | null;
  /** Whether confirming will ask for a PIN (Security). */
  pin_required: boolean;
  pin_reasons: string[];
}

/**
 * Sale (SAL) and Loss Sale (LSS) — §13, §14, §15, §16.
 *
 * The screen this serves is the one used most (§1), so the ordinary case —
 * a registered price, paid in full — passes through with no discount checks
 * to answer, no credit to weigh and no PIN to type. Everything below only
 * engages when the sale departs from that.
 */
@Injectable()
export class SalesService
  implements DocumentPoster, DayCloseBlockerSource, OnModuleInit
{
  readonly docType = doc_type.SAL;
  /** A Loss Sale posts identically; only its rules differ (§13.6). */
  readonly alsoPosts = [doc_type.LSS] as const;
  readonly blockerKind = 'SALE_DRAFT';

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: SalesRepository,
    private readonly customers: CustomersService,
    private readonly pricing: PricingService,
    private readonly reservations: ReservationsService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly accounts: AccountsService,
    private readonly credit: CreditService,
    private readonly confirmation: SaleConfirmService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
    private readonly dayCloseBlockers: DayCloseBlockerRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
    this.dayCloseBlockers.register(this);
  }

  /**
   * Creates a draft sale.
   *
   * Nothing leaves the warehouse and no money moves — that is the confirm.
   * Prices are resolved now so the screen has something to show, and the
   * lines are stored as they will be charged.
   */
  async create(
    dto: CreateSaleDto,
    userId: string,
    role: user_role,
  ): Promise<documents> {
    if (dto.is_loss_sale && role !== user_role.OWNER) {
      throw new ForbiddenException(
        'Loss Sale документин OWNER гана түзөт (§13.6)',
      );
    }
    if (dto.is_loss_sale && !dto.loss_reason?.trim()) {
      throw new BadRequestException(
        'Loss Sale үчүн себеп милдеттүү (§13.6)',
      );
    }

    const reservation = dto.from_reservation
      ? await this.reservations.findOne(dto.from_reservation)
      : null;
    if (reservation && !this.reservations.isLive(reservation)) {
      throw new ConflictException(
        `Бул бронь ${reservation.rstatus} — андан сатуу түзүлбөйт (§17)`,
      );
    }

    const customer = reservation
      ? await this.customers.findOne(reservation.customer_id)
      : dto.customer_id
        ? await this.customers.findOne(dto.customer_id)
        : await this.customers.walkIn();
    if (!customer.is_active) {
      throw new BadRequestException('Кардар активдүү эмес');
    }
    if (reservation && dto.customer_id && dto.customer_id !== customer.id) {
      throw new ConflictException(
        'Бронь башка кардардыкы — сатуу брондун кардарына түзүлөт (§17)',
      );
    }

    const warehouse = await this.warehouses.main();
    // §17.1: the price was fixed when the reservation was made, so the
    // customer pays what they were quoted. The lines still go through the
    // same pricing and costing path, because §13.4 is re-checked at
    // confirmation against today's cost — §17.1 says so explicitly.
    const items = reservation
      ? reservation.reservation_items.map((item) => ({
          product_id: item.product_id,
          qty: item.qty.toFixed(2),
          final_price: item.fixed_price.toFixed(2),
          discount_reason: `Бронь ${reservation.documents.doc_number} боюнча бекитилген баа (§17.1)`,
        }))
      : dto.items;
    const priced = await this.resolveLines(
      { ...dto, items },
      customer.id,
      warehouse.id,
    );
    // §17.1 fixes the price when the reservation is made, so it *is* the
    // price here — not a discount off whatever the list says today. §13.1's
    // discount limit would otherwise refuse a sale nobody discounted. The one
    // re-check §17.1 does ask for, §13.4 against today's cost, still runs.
    const lines = reservation
      ? priced.map((line) => ({
          ...line,
          autoPrice: line.finalPrice,
          discountReason: null,
        }))
      : priced;

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: dto.is_loss_sale ? doc_type.LSS : doc_type.SAL,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.is_loss_sale
          ? `LSS: ${dto.loss_reason!.trim()}`
          : (dto.comment ?? null),
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        customerId: customer.id,
        salesperson: userId,
        isLossSale: dto.is_loss_sale ?? false,
      });

      if (reservation) {
        await tx.sales.update({
          where: { document_id: document.id },
          data: { from_reservation: reservation.document_id },
        });
      }

      await this.repository.insertItems(
        tx,
        document.id,
        lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          autoPrice: line.autoPrice,
          finalPrice: line.finalPrice,
          discountAmount: roundMoney(
            line.autoPrice.minus(line.finalPrice).times(line.qty),
          ),
          discountReason: line.discountReason,
        })),
      );

      if (dto.payments?.length) {
        await this.storePaymentLines(tx, document.id, dto.payments, lines, userId);
      }

      if (dto.debt_due_date) {
        await tx.sales.update({
          where: { document_id: document.id },
          data: { debt_due_date: new Date(`${dto.debt_due_date}T00:00:00Z`) },
        });
      }

      return document;
    });
  }

  /** Replaces the payment lines on a draft (§15). */
  async setPayments(
    saleId: string,
    payments: CreateSaleDto['payments'],
    dueDate: string | undefined,
    userId: string,
  ): Promise<SaleAssessment> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.requireDraft(tx, saleId, userId, 'SET_PAYMENTS');
      const lines = await this.pricedLinesOf(tx, sale, false);

      await this.repository.deletePaymentLines(tx, saleId);
      if (payments?.length) {
        await this.storePaymentLines(tx, saleId, payments, lines, sale.salesperson);
      }
      await tx.sales.update({
        where: { document_id: saleId },
        data: {
          debt_due_date: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
        },
      });

      return this.assess(await this.require(tx, saleId), user_role.OWNER, tx);
    });
  }

  /**
   * Everything the screen needs before confirming (§13, §16.6).
   *
   * Runs the same rules the confirm will, so what the salesperson sees is
   * what happens — including the FIFO cost, simulated from the very layers
   * the confirm will consume (§13.3).
   */
  async preview(
    saleId: string,
    role: user_role,
    db: Db = this.prisma,
  ): Promise<SaleAssessment> {
    return this.assess(await this.require(db, saleId), role, db);
  }

  /** The credit picture for the customer chosen (§16.6). */
  creditStanding(customerId: string) {
    return this.credit.standing(customerId);
  }

  /**
   * Requests the OWNER's approval for a discount past the limit (§13.5).
   */
  async requestApproval(saleId: string, userId: string): Promise<SaleAssessment> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.requireDraft(tx, saleId, userId, 'REQUEST_APPROVAL');
      const lines = await this.pricedLinesOf(tx, sale, false);
      const facts = discountFacts(lines);

      await this.repository.setApproval(tx, saleId, {
        status: approval_status.PENDING,
        requestedAt: new Date(),
      });

      // §13.5 — the OWNER decides on figures, so the figures are recorded
      // with the request rather than fetched again later.
      await this.audit.log(
        {
          userId,
          documentId: saleId,
          entity: 'sales',
          entityId: saleId,
          action: 'SALE_DISCOUNT_APPROVAL_REQUESTED',
          newValue: this.discountAudit(facts, lines),
        },
        tx,
      );

      return this.assess(await this.require(tx, saleId), user_role.OWNER, tx);
    });
  }

  /** The OWNER's answer (§13.5). Never permission to sell below cost. */
  async decideApproval(
    saleId: string,
    dto: ApproveDiscountDto,
    userId: string,
    role: user_role,
  ): Promise<SaleAssessment> {
    if (role !== user_role.OWNER) {
      throw new ForbiddenException('Скидканы OWNER гана бекитет (§13.5)');
    }

    return this.prisma.$transaction(async (tx) => {
      const sale = await this.require(tx, saleId);
      if (sale.approval_status !== approval_status.PENDING) {
        throw new ConflictException(
          'Бул сатуу боюнча бекитүү суралган жок же чечим кабыл алынган',
        );
      }

      await this.repository.setApproval(tx, saleId, {
        status: dto.approved ? approval_status.APPROVED : approval_status.REJECTED,
        ownerId: userId,
        reason: dto.reason,
        decidedAt: new Date(),
      });

      await this.audit.log(
        {
          userId,
          documentId: saleId,
          entity: 'sales',
          entityId: saleId,
          action: dto.approved
            ? 'SALE_DISCOUNT_APPROVED'
            : 'SALE_DISCOUNT_REJECTED',
          newValue: { approved: dto.approved },
          reason: dto.reason,
        },
        tx,
      );

      return this.assess(await this.require(tx, saleId), user_role.OWNER, tx);
    });
  }

  /** Confirming is delegated whole — it is the transaction that matters. */
  post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    return this.confirmation.confirm(tx, document, userId);
  }

  findOne(saleId: string, db: Db = this.prisma): Promise<SaleFull> {
    return this.require(db, saleId);
  }

  findMany(filter: {
    customerId?: string;
    salesperson?: string;
    status?: string;
    limit?: number;
  }) {
    return this.repository.findMany(filter);
  }

  /** A draft sale holds no stock but is unfinished work (Period Lock). */
  async blockers(businessDate: Date): Promise<DayCloseBlocker[]> {
    const drafts = await this.repository.openDrafts(this.prisma);
    return drafts
      .filter(
        (sale) =>
          sale.documents_sales_document_idTodocuments.business_date <= businessDate,
      )
      .map((sale) => ({
        kind: this.blockerKind,
        document_id: sale.document_id,
        doc_number: sale.documents_sales_document_idTodocuments.doc_number,
        detail: 'Сатуу черновик бойдон — тастыкталган же жокко чыгарылган эмес',
      }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The lines, priced and costed.
   *
   * The FIFO cost comes from a simulation over the very layers a confirm
   * would consume, so the §13.4 check is made against the real cost of these
   * units rather than an average (§13.3).
   */
  private async resolveLines(
    dto: CreateSaleDto,
    customerId: string,
    warehouseId: string,
  ): Promise<PricedLine[]> {
    const lines: PricedLine[] = [];

    for (const [index, item] of dto.items.entries()) {
      const qty = toDecimal(item.qty, `items[${index}].qty`);
      if (qty.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`items[${index}].qty must be greater than zero`);
      }

      const suggestion = await this.pricing.suggest({
        productId: item.product_id,
        customerId,
        warehouseId,
        qty,
      });
      const plan = await this.stock.simulateFifo(this.prisma, {
        productId: item.product_id,
        warehouseId,
        qty,
      });

      const autoPrice = new Prisma.Decimal(suggestion.auto_price);
      const finalPrice =
        toOptionalDecimal(item.final_price, `items[${index}].final_price`) ??
        autoPrice;

      lines.push({
        productId: item.product_id,
        sku: suggestion.sku,
        name: suggestion.name,
        qty,
        autoPrice,
        finalPrice,
        minSellingPrice: suggestion.min_selling_price
          ? new Prisma.Decimal(suggestion.min_selling_price)
          : null,
        fifoCogs: plan.cogs,
        discountReason: item.discount_reason?.trim() || null,
      });
    }

    return lines;
  }

  /**
   * The stored lines, with their FIFO cost.
   *
   * A draft is costed by simulating against today's stock — that is what
   * confirming would consume (§13.3). A confirmed sale reads the cost that
   * was *fixed* when it posted: its goods have already left, so re-simulating
   * would either find nothing or price it against someone else's stock.
   */
  private async pricedLinesOf(
    db: Db,
    sale: SaleFull,
    isConfirmed: boolean,
  ): Promise<PricedLine[]> {
    const warehouse = isConfirmed ? null : await this.warehouses.main();
    const lines: PricedLine[] = [];

    for (const item of sale.sale_items) {
      const fifoCogs = isConfirmed
        ? item.fifo_cogs
        : (
            await this.stock.simulateFifo(db, {
              productId: item.product_id,
              warehouseId: warehouse!.id,
              qty: item.qty,
            })
          ).cogs;

      lines.push({
        productId: item.product_id,
        sku: item.products.sku,
        name: item.products.name,
        qty: item.qty,
        autoPrice: item.auto_price,
        finalPrice: item.final_price,
        minSellingPrice: item.products.min_selling_price,
        fifoCogs,
        discountReason: item.discount_reason,
      });
    }

    return lines;
  }

  private async storePaymentLines(
    tx: Prisma.TransactionClient,
    saleId: string,
    payments: NonNullable<CreateSaleDto['payments']>,
    lines: PricedLine[],
    salespersonId: string,
  ): Promise<void> {
    const total = discountFacts(lines).finalTotal;

    const resolved = resolvePayments({
      total,
      salespersonId,
      lines: await Promise.all(
        payments.map(async (line, index) => ({
          account: await this.accounts.findOne(line.account_id),
          amount: toDecimal(line.amount, `payments[${index}].amount`),
          cashGiven:
            toOptionalDecimal(line.cash_given, `payments[${index}].cash_given`) ??
            null,
        })),
      ),
    });

    await this.repository.insertPaymentLines(
      tx,
      saleId,
      resolved.lines.map((line) => ({
        accountId: line.account.id,
        amount: line.amount,
        cashGiven: line.cashGiven,
        changeGiven: line.changeGiven,
      })),
    );
  }

  /** Builds the assessment both the screen and the confirm read. */
  private async assess(
    sale: SaleFull,
    role: user_role,
    db: Db,
  ): Promise<SaleAssessment> {
    const document = await this.documents.findOne(sale.document_id);
    const isConfirmed = document.status === 'CONFIRMED';
    const lines = await this.pricedLinesOf(db, sale, isConfirmed);
    const facts = discountFacts(lines);

    const salesperson = await db.users.findUnique({
      where: { id: sale.salesperson },
      select: { max_discount_pct: true, role: true },
    });

    // A posted sale has passed the rules already; re-running them would only
    // report on stock it no longer holds.
    const blocks = isConfirmed
      ? []
      : saleBlocks({
          lines,
          maxDiscountPct: salesperson?.max_discount_pct ?? ZERO,
          // §13.5 makes the OWNER the approver, so an OWNER's own discount is
          // already approved by the person who would approve it. The block
          // that never lifts — below cost — is unaffected (§13.4).
          discountApproved:
            sale.approval_status === approval_status.APPROVED ||
            salesperson?.role === user_role.OWNER,
          isLossSale: sale.is_loss_sale,
        });

    const paid = sale.sale_payment_lines.reduce(
      (sum, line) => sum.plus(line.amount),
      ZERO,
    );
    const change = sale.sale_payment_lines.reduce(
      (sum, line) => sum.plus(line.change_given ?? ZERO),
      ZERO,
    );
    const outstanding = Prisma.Decimal.max(facts.finalTotal.minus(paid), ZERO);

    const showCogs = await this.confirmation.maySeeCogs(role);
    const pin = await this.confirmation.pinRequirement({
      total: facts.finalTotal,
      outstanding,
      hasManualDiscount: facts.hasManualDiscount,
    });

    return {
      sale_id: sale.document_id,
      doc_number: document.doc_number,
      status: document.status,
      is_loss_sale: sale.is_loss_sale,
      customer: {
        id: sale.customers.id,
        name: sale.customers.name,
        is_walk_in: sale.customers.is_walk_in,
      },
      lines: lines.map((line) => ({
        product_id: line.productId,
        sku: line.sku,
        name: line.name,
        qty: line.qty.toFixed(2),
        auto_price: line.autoPrice.toFixed(2),
        final_price: line.finalPrice.toFixed(2),
        line_total: roundMoney(line.finalPrice.times(line.qty)).toFixed(2),
        fifo_cogs: showCogs ? line.fifoCogs.toFixed(2) : null,
      })),
      totals: {
        auto_total: facts.autoTotal.toFixed(2),
        total: facts.finalTotal.toFixed(2),
        discount_amount: facts.discountAmount.toFixed(2),
        discount_pct: facts.discountPct.toFixed(2),
        fifo_cogs: showCogs ? facts.fifoCogs.toFixed(2) : null,
        margin: showCogs ? facts.margin.toFixed(2) : null,
      },
      payment: {
        paid: paid.toFixed(2),
        change: change.toFixed(2),
        outstanding: outstanding.toFixed(2),
      },
      blocks,
      approval_status: sale.approval_status,
      pin_required: pin.required,
      pin_reasons: pin.reasons,
    };
  }

  /** §13.8's field list, in one place so the request and the sale agree. */
  private discountAudit(
    facts: DiscountFacts,
    lines: PricedLine[],
  ): Prisma.InputJsonValue {
    return {
      auto_total: facts.autoTotal.toFixed(2),
      final_total: facts.finalTotal.toFixed(2),
      discount_amount: facts.discountAmount.toFixed(2),
      discount_pct: facts.discountPct.toFixed(2),
      fifo_cogs: facts.fifoCogs.toFixed(2),
      margin: facts.margin.toFixed(2),
      lines: lines.map((line) => ({
        sku: line.sku,
        qty: line.qty.toFixed(2),
        auto_price: line.autoPrice.toFixed(2),
        final_price: line.finalPrice.toFixed(2),
        reason: line.discountReason,
      })),
    };
  }

  private async requireDraft(
    tx: Prisma.TransactionClient,
    saleId: string,
    userId: string,
    action: string,
  ): Promise<SaleFull> {
    await this.documents.assertDraft(tx, saleId, userId, action);
    return this.require(tx, saleId);
  }

  private async require(db: Db, saleId: string): Promise<SaleFull> {
    const sale = await this.repository.findById(db, saleId);
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    return sale;
  }
}

export { ZERO as SALE_ZERO, debt_status };
