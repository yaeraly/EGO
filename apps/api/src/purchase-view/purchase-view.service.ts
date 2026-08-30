import { Injectable } from '@nestjs/common';
import { Prisma, currency_code, purchase_status, supplier_payments } from '@prisma/client';
import { CargoCompaniesService, SuppliersService } from '../counterparties/counterparties.service';
import { ReferenceRateService } from '../currency/reference-rate.service';
import { money, requiredMoney } from '../common/money-json';
import { DocumentsService } from '../documents/documents.service';
import { SupplierLedgerService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { PurchaseWithItems } from '../purchases/purchases.repository';
import { PurchasesService, StageDuration } from '../purchases/purchases.service';
import { SupplierPaymentsRepository } from '../supplier-payments/supplier-payments.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * Payment status for one order (§4.2).
 *
 * Independent of where the goods physically are (§6) — an order can be paid
 * in full while still sitting in Yiwu, or arrive completely unpaid.
 */
export enum PurchasePaymentStatus {
  UNPAID = 'UNPAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
}

/** One payment against the order, with its money at full scale. */
export interface PurchasePayment {
  document_id: string;
  amount_cny: string;
  kgs_value: string;
  debt_part_cny: string | null;
  prepay_part_cny: string | null;
  fx_gain_loss_kgs: string | null;
  channel: string | null;
}

export interface PurchaseTotals {
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  status: PurchasePaymentStatus;
}

export interface PurchaseCard {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: Date;
    comment: string | null;
  };
  supplier: { id: string; name: string; contact: string | null };
  cargo_company: { id: string; name: string } | null;
  logistics: {
    status: purchase_status;
    stage: number;
    history: StageDuration[];
    lead_time_days: number | null;
  };
  items: {
    product_id: string;
    sku: string;
    name: string;
    qty: string;
    price_cny: string;
    line_total_cny: string;
  }[];
  totals: {
    total_cny: string;
    paid_cny: string;
    outstanding_cny: string;
    payment_status: PurchasePaymentStatus;
    /**
     * Informational only (§4.2): the debt itself is a yuan debt, and this
     * figure is what it would be worth today at the reference rate.
     */
    total_kgs_reference: string | null;
    reference_rate: string | null;
    reference_rate_source: string | null;
  };
  payments: PurchasePayment[];
  supplier_balance_cny: string;
}

@Injectable()
export class PurchaseViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
    private readonly documents: DocumentsService,
    private readonly suppliers: SuppliersService,
    private readonly cargoCompanies: CargoCompaniesService,
    private readonly products: ProductsService,
    private readonly payments: SupplierPaymentsRepository,
    private readonly ledger: SupplierLedgerService,
    private readonly referenceRate: ReferenceRateService,
  ) {}

  async card(documentId: string): Promise<PurchaseCard> {
    const purchase = await this.purchases.findOne(documentId);
    const document = await this.documents.findOne(documentId);
    const supplier = await this.suppliers.findOne(purchase.supplier_id);
    const cargoCompany = purchase.cargo_company_id
      ? await this.cargoCompanies.findOne(purchase.cargo_company_id)
      : null;

    const total = this.purchases.totalCny(purchase);
    const paid = await this.payments.confirmedTotalForPurchase(
      this.prisma,
      documentId,
    );

    const productsById = await this.products.requireActive(
      this.prisma,
      purchase.purchase_items.map((item) => item.product_id),
    ).catch(() =>
      // An order may legitimately reference a product later retired; the card
      // still has to render, so fall back to whatever is on file.
      this.prisma.products
        .findMany({
          where: {
            id: { in: purchase.purchase_items.map((i) => i.product_id) },
          },
        })
        .then((rows) => new Map(rows.map((p) => [p.id, p]))),
    );

    const history = await this.purchases.stageDurations(this.prisma, documentId);

    const reference = await this.referenceRate
      .forCurrency(currency_code.CNY)
      .catch(() => null);

    return {
      document: {
        id: document.id,
        doc_number: document.doc_number,
        status: document.status,
        business_date: document.business_date,
        comment: document.comment,
      },
      supplier: {
        id: supplier.id,
        name: supplier.name,
        contact: supplier.contact,
      },
      cargo_company: cargoCompany
        ? { id: cargoCompany.id, name: cargoCompany.name }
        : null,
      logistics: {
        status: purchase.logistics_status,
        stage: history.at(-1)?.stage ?? 1,
        history,
        lead_time_days: await this.purchases.leadTimeDays(documentId),
      },
      items: purchase.purchase_items.map((item) => ({
        product_id: item.product_id,
        sku: productsById.get(item.product_id)?.sku ?? '(removed)',
        name: productsById.get(item.product_id)?.name ?? '(removed)',
        qty: item.qty.toFixed(2),
        price_cny: item.price_cny.toFixed(2),
        line_total_cny: item.qty.times(item.price_cny).toFixed(2),
      })),
      totals: {
        total_cny: total.toFixed(2),
        paid_cny: paid.toFixed(2),
        outstanding_cny: Prisma.Decimal.max(total.minus(paid), ZERO).toFixed(2),
        payment_status: paymentStatus(total, paid),
        total_kgs_reference: reference
          ? total.times(reference.rate).toFixed(2)
          : null,
        reference_rate: reference?.rate.toString() ?? null,
        reference_rate_source: reference?.source ?? null,
      },
      payments: (
        await this.payments.listForPurchase(this.prisma, documentId)
      ).map(asPurchasePayment),
      supplier_balance_cny: (
        await this.ledger.balance(purchase.supplier_id)
      ).toFixed(2),
    };
  }

  /** The same status for every order in a list, without N+1 card builds. */
  async paymentStatuses(
    purchases: PurchaseWithItems[],
  ): Promise<Map<string, PurchaseTotals>> {
    const paidByPurchase = await this.payments.confirmedTotalsForPurchases(
      this.prisma,
      purchases.map((purchase) => purchase.document_id),
    );

    return new Map(
      purchases.map((purchase) => {
        const total = this.purchases.totalCny(purchase);
        const paid = paidByPurchase.get(purchase.document_id) ?? ZERO;
        return [
          purchase.document_id,
          { total, paid, status: paymentStatus(total, paid) },
        ];
      }),
    );
  }
}

function asPurchasePayment(row: supplier_payments): PurchasePayment {
  return {
    document_id: row.document_id,
    amount_cny: requiredMoney(row.amount_cny),
    kgs_value: requiredMoney(row.kgs_value),
    debt_part_cny: money(row.debt_part_cny),
    prepay_part_cny: money(row.prepay_part_cny),
    fx_gain_loss_kgs: money(row.fx_gain_loss_kgs),
    channel: row.channel,
  };
}

export function paymentStatus(
  total: Prisma.Decimal,
  paid: Prisma.Decimal,
): PurchasePaymentStatus {
  if (paid.lessThanOrEqualTo(0)) {
    return PurchasePaymentStatus.UNPAID;
  }
  if (paid.greaterThanOrEqualTo(total)) {
    return PurchasePaymentStatus.PAID;
  }
  return PurchasePaymentStatus.PARTIALLY_PAID;
}
