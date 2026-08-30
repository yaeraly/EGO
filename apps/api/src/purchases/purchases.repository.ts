import { Injectable } from '@nestjs/common';
import { Prisma, purchase_items, purchase_status, purchase_status_history, purchases } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type PurchaseWithItems = Prisma.purchasesGetPayload<{
  include: { purchase_items: true };
}>;

export type PurchaseListRow = Prisma.purchasesGetPayload<{
  include: {
    purchase_items: true;
    suppliers: { select: { id: true; name: true } };
    documents: {
      select: { doc_number: true; business_date: true; status: true };
    };
  };
}>;

@Injectable()
export class PurchasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      supplierId: string;
      cargoCompanyId: string | null;
    },
  ): Promise<purchases> {
    return tx.purchases.create({
      data: {
        document_id: data.documentId,
        supplier_id: data.supplierId,
        cargo_company_id: data.cargoCompanyId,
      },
    });
  }

  async insertItems(
    tx: Prisma.TransactionClient,
    purchaseId: string,
    items: { productId: string; qty: Prisma.Decimal; priceCny: Prisma.Decimal }[],
  ): Promise<void> {
    await tx.purchase_items.createMany({
      data: items.map((item) => ({
        purchase_id: purchaseId,
        product_id: item.productId,
        qty: item.qty,
        price_cny: item.priceCny,
      })),
    });
  }

  async deleteItems(
    tx: Prisma.TransactionClient,
    purchaseId: string,
  ): Promise<void> {
    await tx.purchase_items.deleteMany({ where: { purchase_id: purchaseId } });
  }

  findById(db: Db, documentId: string): Promise<PurchaseWithItems | null> {
    return db.purchases.findUnique({
      where: { document_id: documentId },
      include: { purchase_items: true },
    });
  }

  findItems(db: Db, purchaseId: string): Promise<purchase_items[]> {
    return db.purchase_items.findMany({
      where: { purchase_id: purchaseId },
      orderBy: { id: 'asc' },
    });
  }

  updateCargoCompany(
    tx: Prisma.TransactionClient,
    documentId: string,
    cargoCompanyId: string | null,
  ): Promise<purchases> {
    return tx.purchases.update({
      where: { document_id: documentId },
      data: { cargo_company_id: cargoCompanyId },
    });
  }

  setLogisticsStatus(
    tx: Prisma.TransactionClient,
    documentId: string,
    status: purchase_status,
  ): Promise<purchases> {
    return tx.purchases.update({
      where: { document_id: documentId },
      data: { logistics_status: status },
    });
  }

  async insertStatusHistory(
    tx: Prisma.TransactionClient,
    data: { purchaseId: string; status: purchase_status; userId: string },
  ): Promise<void> {
    await tx.purchase_status_history.create({
      data: {
        purchase_id: data.purchaseId,
        status: data.status,
        user_id: data.userId,
      },
    });
  }

  statusHistory(
    db: Db,
    purchaseId: string,
  ): Promise<purchase_status_history[]> {
    return db.purchase_status_history.findMany({
      where: { purchase_id: purchaseId },
      orderBy: [{ at: 'asc' }, { id: 'asc' }],
    });
  }

  /** Locks the purchase row so two status changes cannot interleave. */
  async lockForStatusChange(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<purchases | undefined> {
    const [row] = await tx.$queryRaw<purchases[]>`
      SELECT * FROM purchases WHERE document_id = ${documentId}::uuid FOR UPDATE
    `;
    return row;
  }

  findMany(filter: {
    supplierId?: string;
    logisticsStatus?: purchase_status;
  }): Promise<PurchaseListRow[]> {
    return this.prisma.purchases.findMany({
      where: {
        supplier_id: filter.supplierId,
        logistics_status: filter.logisticsStatus,
      },
      include: {
        purchase_items: true,
        suppliers: { select: { id: true, name: true } },
        documents: {
          select: { doc_number: true, business_date: true, status: true },
        },
      },
      orderBy: { documents: { created_at: 'desc' } },
      take: 200,
    });
  }
}
