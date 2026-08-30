import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, currency_code, doc_type, documents, purchase_status, user_role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { SuppliersService, CargoCompaniesService } from '../counterparties/counterparties.service';
import { ReferenceRateService } from '../currency/reference-rate.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { SupplierLedgerService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import {
  AdvanceStatusDto,
  CreatePurchaseDto,
  PurchaseItemDto,
  ReplacePurchaseItemsDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import { LOGISTICS_SEQUENCE, nextStage, stageIndex, stageNumber } from './logistics-status';
import { PurchaseListRow, PurchaseWithItems, PurchasesRepository } from './purchases.repository';

const ZERO = new Prisma.Decimal(0);

export interface StageDuration {
  status: purchase_status;
  stage: number;
  entered_at: Date;
  /** Whole days spent at this stage; null while it is the current one. */
  days: number | null;
  user_id: string;
}

/**
 * Purchase (PUR) — §4.1, §6.
 *
 * The order placed with the Chinese supplier. Its lines are priced in CNY, and
 * confirming it recognises what we owe (§4.2). Its logistics stage (§6) runs
 * independently of its payment status: goods move whether or not they are
 * paid for, and neither blocks the other.
 */
@Injectable()
export class PurchasesService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.PUR;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: PurchasesRepository,
    private readonly suppliers: SuppliersService,
    private readonly cargoCompanies: CargoCompaniesService,
    private readonly products: ProductsService,
    private readonly referenceRate: ReferenceRateService,
    private readonly ledger: SupplierLedgerService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreatePurchaseDto, userId: string): Promise<documents> {
    await this.suppliers.findOne(dto.supplier_id);
    if (dto.cargo_company_id) {
      await this.cargoCompanies.findOne(dto.cargo_company_id);
    }

    const items = await this.validateItems(dto.items);

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.PUR,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        supplierId: dto.supplier_id,
        cargoCompanyId: dto.cargo_company_id ?? null,
      });
      await this.repository.insertItems(tx, document.id, items);

      return document;
    });
  }

  /**
   * Lines are only editable while the document is a DRAFT (§27.1); once it is
   * confirmed the order has been placed and the payable recognised, and a
   * change goes through a correction document.
   */
  async replaceItems(
    documentId: string,
    dto: ReplacePurchaseItemsDto,
    userId: string,
  ): Promise<PurchaseWithItems> {
    const items = await this.validateItems(dto.items);

    return this.prisma.$transaction(async (tx) => {
      await this.documents.assertDraft(tx, documentId, userId, 'REPLACE_ITEMS');
      const before = await this.requirePurchase(tx, documentId);

      await this.repository.deleteItems(tx, documentId);
      await this.repository.insertItems(tx, documentId, items);

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'purchase_items',
          entityId: documentId,
          action: 'PURCHASE_ITEMS_REPLACED',
          oldValue: { total_cny: totalCny(before).toFixed(2), lines: before.purchase_items.length },
          newValue: {
            total_cny: items
              .reduce((sum, i) => sum.plus(i.qty.times(i.priceCny)), ZERO)
              .toFixed(2),
            lines: items.length,
          },
        },
        tx,
      );

      return this.requirePurchase(tx, documentId);
    });
  }

  async update(
    documentId: string,
    dto: UpdatePurchaseDto,
    userId: string,
  ): Promise<PurchaseWithItems> {
    if (dto.cargo_company_id) {
      await this.cargoCompanies.findOne(dto.cargo_company_id);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.documents.assertDraft(tx, documentId, userId, 'UPDATE_PURCHASE');
      const before = await this.requirePurchase(tx, documentId);

      await this.repository.updateCargoCompany(
        tx,
        documentId,
        dto.cargo_company_id ?? null,
      );

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'purchases',
          entityId: documentId,
          action: 'PURCHASE_UPDATED',
          oldValue: { cargo_company_id: before.cargo_company_id },
          newValue: { cargo_company_id: dto.cargo_company_id ?? null },
        },
        tx,
      );

      return this.requirePurchase(tx, documentId);
    });
  }

  /**
   * Confirming the order recognises the payable (§4.2).
   *
   * The amount is the order total in CNY — the debt itself is a yuan debt. Its
   * KGS value is booked at the reference rate (§10.1) so that a later payment
   * has something to measure gain or loss against; the rate and its source go
   * into the Audit Log, as §10.1 requires.
   *
   * If the goods arrive short, Module 3 adjusts this per §8.3 rather than
   * rewriting the entry.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const purchase = await this.requirePurchase(tx, document.id);
    if (purchase.purchase_items.length === 0) {
      throw new BadRequestException(
        `${document.doc_number} has no lines; add at least one before confirming`,
      );
    }

    const total = totalCny(purchase);
    const reference = await this.referenceRate.forCurrency(currency_code.CNY);

    await this.ledger.recordPayable(tx, {
      supplierId: purchase.supplier_id,
      documentId: document.id,
      amountCny: total,
      rateKgs: reference.rate,
    });

    // The starting point of the timeline, so §6's stage durations have an
    // origin to measure from.
    await this.repository.insertStatusHistory(tx, {
      purchaseId: document.id,
      status: purchase.logistics_status,
      userId,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'purchases',
        entityId: document.id,
        action: 'PURCHASE_CONFIRMED',
        newValue: {
          supplier_id: purchase.supplier_id,
          total_cny: total.toFixed(2),
          reference_rate: reference.rate.toString(),
          reference_rate_source: reference.source,
          payable_kgs: total.times(reference.rate).toFixed(2),
        },
      },
      tx,
    );
  }

  /**
   * Moves the purchase along §6's 16 stages.
   *
   * A salesperson may take the next step only. The OWNER may set any stage,
   * because word from China arrives late and out of order — a shipment often
   * turns out to have cleared customs days ago. Such a jump is recorded in the
   * Audit Log with its reason; the ordinary one-step move is not, since the
   * history table already holds it.
   */
  async advanceStatus(
    documentId: string,
    dto: AdvanceStatusDto,
    userId: string,
    role: user_role,
  ): Promise<{ purchase: PurchaseWithItems; history: StageDuration[] }> {
    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.findOne(documentId);
      if (document.status !== 'CONFIRMED') {
        throw new ConflictException(
          `${document.doc_number} is ${document.status}: confirm the order before moving it along`,
        );
      }

      const locked = await this.repository.lockForStatusChange(tx, documentId);
      if (!locked) {
        throw new NotFoundException('Purchase not found');
      }

      const from = locked.logistics_status;
      const to = dto.status;

      if (from === to) {
        throw new ConflictException(
          `${document.doc_number} is already at ${to}`,
        );
      }

      const isNextStep = nextStage(from) === to;
      if (!isNextStep && role !== user_role.OWNER) {
        const expected = nextStage(from);
        throw new ForbiddenException(
          expected
            ? `Only the next stage is allowed here (${stageNumber(from)} -> ${stageNumber(expected)}, ${expected}); an OWNER can set another stage`
            : `${from} is the final stage`,
        );
      }

      await this.repository.setLogisticsStatus(tx, documentId, to);
      await this.repository.insertStatusHistory(tx, {
        purchaseId: documentId,
        status: to,
        userId,
      });

      if (!isNextStep) {
        await this.audit.log(
          {
            userId,
            documentId,
            entity: 'purchases',
            entityId: documentId,
            action: 'PURCHASE_STATUS_JUMPED',
            oldValue: { status: from, stage: stageNumber(from) },
            newValue: { status: to, stage: stageNumber(to) },
            reason:
              dto.reason ??
              (stageIndex(to) < stageIndex(from)
                ? 'moved back without a stated reason'
                : 'skipped stages without a stated reason'),
          },
          tx,
        );
      }

      return {
        purchase: await this.requirePurchase(tx, documentId),
        history: await this.stageDurations(tx, documentId),
      };
    });
  }

  /**
   * How long the shipment sat at each stage, and the total lead time (§6).
   *
   * The last entry has no duration yet — the purchase is still there.
   */
  async stageDurations(
    db: Db | undefined,
    purchaseId: string,
  ): Promise<StageDuration[]> {
    const history = await this.repository.statusHistory(
      db ?? this.prisma,
      purchaseId,
    );

    return history.map((entry, index) => {
      const next = history[index + 1];
      return {
        status: entry.status,
        stage: stageNumber(entry.status),
        entered_at: entry.at,
        days: next ? wholeDaysBetween(entry.at, next.at) : null,
        user_id: entry.user_id,
      };
    });
  }

  async leadTimeDays(purchaseId: string): Promise<number | null> {
    const history = await this.repository.statusHistory(this.prisma, purchaseId);
    if (history.length < 2) {
      return null;
    }
    return wholeDaysBetween(history[0].at, history[history.length - 1].at);
  }

  findOne(documentId: string): Promise<PurchaseWithItems> {
    return this.requirePurchase(this.prisma, documentId);
  }

  /** Guards a payment naming a purchase that belongs to someone else. */
  async assertBelongsToSupplier(
    documentId: string,
    supplierId: string,
  ): Promise<PurchaseWithItems> {
    const purchase = await this.repository.findById(this.prisma, documentId);
    if (!purchase) {
      throw new NotFoundException('purchase_id does not exist');
    }
    if (purchase.supplier_id !== supplierId) {
      throw new BadRequestException(
        'purchase_id belongs to a different supplier',
      );
    }
    return purchase;
  }

  findMany(filter: {
    supplierId?: string;
    logisticsStatus?: purchase_status;
  }): Promise<PurchaseListRow[]> {
    return this.repository.findMany(filter);
  }

  totalCny(purchase: PurchaseWithItems): Prisma.Decimal {
    return totalCny(purchase);
  }

  private async requirePurchase(
    db: Db,
    documentId: string,
  ): Promise<PurchaseWithItems> {
    const purchase = await this.repository.findById(db, documentId);
    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }
    return purchase;
  }

  private async validateItems(
    items: PurchaseItemDto[],
  ): Promise<{ productId: string; qty: Prisma.Decimal; priceCny: Prisma.Decimal }[]> {
    const parsed = items.map((item, index) => {
      const qty = toDecimal(item.qty, `items[${index}].qty`);
      const priceCny = toDecimal(item.price_cny, `items[${index}].price_cny`);
      if (qty.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`items[${index}].qty must be greater than zero`);
      }
      if (priceCny.isNegative()) {
        throw new BadRequestException(`items[${index}].price_cny cannot be negative`);
      }
      return { productId: item.product_id, qty, priceCny };
    });

    await this.products.requireActive(
      this.prisma,
      parsed.map((item) => item.productId),
    );

    return parsed;
  }
}

export function totalCny(purchase: PurchaseWithItems): Prisma.Decimal {
  return purchase.purchase_items.reduce(
    (sum, item) => sum.plus(item.qty.times(item.price_cny)),
    ZERO,
  );
}

export { LOGISTICS_SEQUENCE };

function wholeDaysBetween(from: Date, to: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - from.getTime()) / millisecondsPerDay);
}
