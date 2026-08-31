import { Injectable } from '@nestjs/common';
import { return_condition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReturnFull } from './returns.repository';
import { ReturnsService } from './returns.service';

export interface ReturnView {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  original_sale: { id: string; doc_number: string };
  customer: { id: string; name: string };
  reason: string;
  /** Money at full scale, as every money field in this API is (CLAUDE.md). */
  total_return_amount: string;
  debt_offset: string;
  cash_refund: string;
  items: {
    id: string;
    sale_item_id: string;
    sku: string;
    name: string;
    qty: string;
    condition: return_condition;
    original_price: string;
    original_unit_cost: string;
    /** §36-А.2 — null when the line is not a defect return. */
    warranty_ok: boolean | null;
    owner_exception_reason: string | null;
    new_layer_id: string | null;
  }[];
  refunds: {
    account_id: string;
    account_name: string;
    amount: string;
    source_override_reason: string | null;
  }[];
}

@Injectable()
export class ReturnsViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly returns: ReturnsService,
  ) {}

  async list(filter: {
    customerId?: string;
    originalSale?: string;
  }): Promise<ReturnView[]> {
    const rows = await this.returns.findMany(filter);
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async one(id: string): Promise<ReturnView> {
    return this.toView(await this.returns.findOne(id));
  }

  private async toView(record: ReturnFull): Promise<ReturnView> {
    const items = await this.prisma.sale_items.findMany({
      where: { id: { in: record.return_items.map((item) => item.sale_item_id) } },
      include: { products: { select: { sku: true, name: true } } },
    });
    const byId = new Map(items.map((item) => [item.id, item]));

    const refunds = await this.prisma.refund_lines.findMany({
      where: { return_id: record.document_id },
      include: { payment_accounts: { select: { name: true } } },
      orderBy: { id: 'asc' },
    });

    const sale = await this.prisma.documents.findUniqueOrThrow({
      where: { id: record.original_sale },
      select: { doc_number: true },
    });

    return {
      document: {
        id: record.document_id,
        doc_number: record.documents.doc_number,
        status: record.documents.status,
        business_date: record.documents.business_date.toISOString().slice(0, 10),
        comment: record.documents.comment,
      },
      original_sale: { id: record.original_sale, doc_number: sale.doc_number },
      customer: { id: record.customers.id, name: record.customers.name },
      reason: record.reason,
      total_return_amount: record.total_return_amount.toFixed(2),
      debt_offset: record.debt_offset.toFixed(2),
      cash_refund: record.cash_refund.toFixed(2),
      items: record.return_items.map((item) => ({
        id: item.id,
        sale_item_id: item.sale_item_id,
        sku: byId.get(item.sale_item_id)?.products.sku ?? '(removed)',
        name: byId.get(item.sale_item_id)?.products.name ?? '(removed)',
        qty: item.qty.toFixed(2),
        condition: item.condition,
        original_price: item.original_price.toFixed(2),
        original_unit_cost: item.original_unit_cost.toFixed(4),
        warranty_ok: item.warranty_ok,
        owner_exception_reason: item.owner_exception_reason,
        new_layer_id: item.new_layer_id,
      })),
      refunds: refunds.map((line) => ({
        account_id: line.account_id,
        account_name: line.payment_accounts.name,
        amount: line.amount.toFixed(2),
        source_override_reason: line.source_override_reason,
      })),
    };
  }
}
