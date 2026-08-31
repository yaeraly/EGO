import { Injectable } from '@nestjs/common';
import { Prisma, transfer_status, warehouse_transfers } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type TransferWithItems = Prisma.warehouse_transfersGetPayload<{
  include: {
    warehouse_transfer_items: { include: { fifo_layers: true } };
    warehouses_warehouse_transfers_from_warehouseTowarehouses: true;
    warehouses_warehouse_transfers_to_warehouseTowarehouses: true;
  };
}>;

@Injectable()
export class WarehouseTransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: { documentId: string; fromWarehouse: string; toWarehouse: string },
  ): Promise<warehouse_transfers> {
    return tx.warehouse_transfers.create({
      data: {
        document_id: data.documentId,
        from_warehouse: data.fromWarehouse,
        to_warehouse: data.toWarehouse,
      },
    });
  }

  insertItems(
    tx: Prisma.TransactionClient,
    transferId: string,
    items: { layerId: string; qty: Prisma.Decimal; unitCost: Prisma.Decimal }[],
  ): Promise<Prisma.BatchPayload> {
    return tx.warehouse_transfer_items.createMany({
      data: items.map((item) => ({
        transfer_id: transferId,
        layer_id: item.layerId,
        qty: item.qty,
        unit_cost: item.unitCost,
      })),
    });
  }

  deleteItems(tx: Prisma.TransactionClient, transferId: string) {
    return tx.warehouse_transfer_items.deleteMany({
      where: { transfer_id: transferId },
    });
  }

  findById(db: Db, documentId: string): Promise<TransferWithItems | null> {
    return db.warehouse_transfers.findUnique({
      where: { document_id: documentId },
      include: {
        warehouse_transfer_items: { include: { fifo_layers: true } },
        warehouses_warehouse_transfers_from_warehouseTowarehouses: true,
        warehouses_warehouse_transfers_to_warehouseTowarehouses: true,
      },
    });
  }

  /** Locks the transfer row so two people cannot send or receive it at once. */
  async lock(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<{ tstatus: transfer_status } | null> {
    const rows = await tx.$queryRaw<{ tstatus: transfer_status }[]>`
      SELECT tstatus FROM warehouse_transfers
      WHERE document_id = ${documentId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async setStatus(
    tx: Prisma.TransactionClient,
    documentId: string,
    data: {
      tstatus: transfer_status;
      sentBy?: string;
      receivedBy?: string;
    },
  ): Promise<void> {
    await tx.warehouse_transfers.update({
      where: { document_id: documentId },
      data: {
        tstatus: data.tstatus,
        ...(data.sentBy ? { sent_by: data.sentBy, sent_at: new Date() } : {}),
        ...(data.receivedBy
          ? { received_by: data.receivedBy, received_at: new Date() }
          : {}),
      },
    });
  }

  findMany(filter: { status?: transfer_status }) {
    return this.prisma.warehouse_transfers.findMany({
      where: { ...(filter.status ? { tstatus: filter.status } : {}) },
      include: {
        documents: true,
        warehouses_warehouse_transfers_from_warehouseTowarehouses: {
          select: { id: true, code: true, name: true },
        },
        warehouses_warehouse_transfers_to_warehouseTowarehouses: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: { documents: { created_at: 'desc' } },
    });
  }

  /**
   * Transfers sent but not yet received — goods in flight between our own
   * warehouses, which the day cannot be closed over (Period Lock pre-check).
   */
  inFlight(db: Db) {
    return db.warehouse_transfers.findMany({
      where: { tstatus: transfer_status.SENT },
      include: { documents: { select: { doc_number: true, business_date: true } } },
      orderBy: { sent_at: 'asc' },
    });
  }
}
