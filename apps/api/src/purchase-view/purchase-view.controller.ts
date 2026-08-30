import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { purchase_status } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PurchasesService } from '../purchases/purchases.service';
import { PurchaseCard, PurchasePaymentStatus, PurchaseViewService } from './purchase-view.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @IsEnum(purchase_status)
  logistics_status?: purchase_status;
}

export interface PurchaseListItem {
  document_id: string;
  doc_number: string;
  business_date: Date;
  document_status: string;
  supplier: { id: string; name: string };
  logistics_status: purchase_status;
  total_cny: string;
  paid_cny: string;
  payment_status: PurchasePaymentStatus;
}

/** The screens §2.8 describes: a list to scan, and a card to work from. */
@Controller('purchase-board')
export class PurchaseViewController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly view: PurchaseViewService,
  ) {}

  @Get()
  async list(@Query() query: ListQueryDto): Promise<PurchaseListItem[]> {
    const rows = await this.purchases.findMany({
      supplierId: query.supplier_id,
      logisticsStatus: query.logistics_status,
    });

    const statuses = await this.view.paymentStatuses(rows);

    return rows.map((row) => {
      const payment = statuses.get(row.document_id)!;

      return {
        document_id: row.document_id,
        doc_number: row.documents.doc_number,
        business_date: row.documents.business_date,
        document_status: row.documents.status,
        supplier: { id: row.suppliers.id, name: row.suppliers.name },
        logistics_status: row.logistics_status,
        total_cny: payment.total.toFixed(2),
        paid_cny: payment.paid.toFixed(2),
        payment_status: payment.status,
      };
    });
  }

  @Get(':id')
  card(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseCard> {
    return this.view.card(id);
  }
}
