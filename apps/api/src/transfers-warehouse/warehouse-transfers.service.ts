import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  Prisma,
  doc_type,
  documents,
  stock_movement_type,
  transfer_status,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  DayCloseBlocker,
  DayCloseBlockerRegistry,
  DayCloseBlockerSource,
} from '../business-days/day-close-blockers';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateTransferDto } from './dto/warehouse-transfer.dto';
import {
  TransferWithItems,
  WarehouseTransfersRepository,
} from './warehouse-transfers.repository';

/**
 * Warehouse Transfer (TRF) — §12-А.4–5.
 *
 * Goods never move between warehouses by editing a number (§12-А.8.3–4);
 * they move on this document, in two steps, because that is what physically
 * happens: they leave one warehouse, and some time later they arrive at
 * another. Between the two they are in flight, which is why an unreceived
 * transfer blocks the day's close.
 *
 * A transfer is not a sale, a purchase, income or an expense, so the cost
 * travels untouched: the same layer, the same `unit_cost` (§12-А.5).
 */
@Injectable()
export class WarehouseTransfersService
  implements DocumentPoster, DayCloseBlockerSource, OnModuleInit
{
  readonly docType = doc_type.TRF;
  readonly blockerKind = 'TRANSFER_IN_FLIGHT';

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: WarehouseTransfersRepository,
    private readonly warehouses: WarehousesService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
    private readonly dayCloseBlockers: DayCloseBlockerRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
    this.dayCloseBlockers.register(this);
  }

  /**
   * Goods that left one warehouse and have not arrived at the other.
   *
   * Closing the day over them would seal a period in which stock is
   * unaccounted for: it is out of the origin and not yet in the destination.
   * Every transfer still SENT counts, whichever day it was sent on — an older
   * one is more of a problem, not less.
   */
  async blockers(businessDate: Date): Promise<DayCloseBlocker[]> {
    const sent = await this.repository.inFlight(this.prisma);
    return sent
      .filter((transfer) => transfer.documents.business_date <= businessDate)
      .map((transfer) => ({
        kind: this.blockerKind,
        document_id: transfer.document_id,
        doc_number: transfer.documents.doc_number,
        detail:
          `Transfer sent on ${transfer.documents.business_date.toISOString().slice(0, 10)} ` +
          'has not been received (§12-А.4)',
      }));
  }

  async create(dto: CreateTransferDto, userId: string): Promise<documents> {
    if (dto.from_warehouse === dto.to_warehouse) {
      throw new BadRequestException(
        'A transfer needs two different warehouses (§12-А.4)',
      );
    }
    await this.warehouses.requireActive(dto.from_warehouse);
    await this.warehouses.requireActive(dto.to_warehouse);

    const items = dto.items.map((item, index) => ({
      layerId: item.layer_id,
      qty: toDecimal(item.qty, `items[${index}].qty`),
    }));
    for (const [index, item] of items.entries()) {
      if (item.qty.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`items[${index}].qty must be greater than zero`);
      }
    }

    // Checked here so an impossible transfer is refused while it is still a
    // draft, rather than at send time with the goods already promised.
    for (const item of items) {
      const onHand = await this.stock.onHand(
        this.prisma,
        item.layerId,
        dto.from_warehouse,
      );
      if (onHand.lessThan(item.qty)) {
        throw new ConflictException(
          `Layer ${item.layerId} holds ${onHand.toFixed(2)} in that warehouse, not ${item.qty.toFixed(2)}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.TRF,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        fromWarehouse: dto.from_warehouse,
        toWarehouse: dto.to_warehouse,
      });

      const withCost = [];
      for (const item of items) {
        const layer = await tx.fifo_layers.findUnique({
          where: { id: item.layerId },
          select: { unit_cost: true },
        });
        if (!layer) {
          throw new NotFoundException(`FIFO layer ${item.layerId} not found`);
        }
        withCost.push({ ...item, unitCost: layer.unit_cost });
      }
      await this.repository.insertItems(tx, document.id, withCost);

      return document;
    });
  }

  /**
   * Confirming the document is the send (§12-А.4).
   *
   * The goods leave the origin now; nothing arrives yet. `receive()` finishes
   * the journey.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const transfer = await this.requireTransfer(tx, document.id);
    if (transfer.warehouse_transfer_items.length === 0) {
      throw new BadRequestException(
        `${document.doc_number} has no lines; add at least one before sending`,
      );
    }

    await this.warehouses.requireActive(transfer.from_warehouse, tx);

    for (const item of transfer.warehouse_transfer_items) {
      await this.stock.removeFromWarehouse(tx, {
        layerId: item.layer_id,
        warehouseId: transfer.from_warehouse,
        qty: item.qty,
        documentId: document.id,
        movementType: stock_movement_type.TRANSFER_OUT,
      });
    }

    await this.repository.setStatus(tx, document.id, {
      tstatus: transfer_status.SENT,
      sentBy: userId,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'warehouse_transfers',
        entityId: document.id,
        action: 'TRANSFER_SENT',
        newValue: {
          from_warehouse: transfer.from_warehouse,
          to_warehouse: transfer.to_warehouse,
          lines: transfer.warehouse_transfer_items.length,
        },
      },
      tx,
    );
  }

  /**
   * The receiving end (§12-А.4).
   *
   * The same layer lands in the destination at the same `unit_cost` — a
   * transfer changes where goods are, never what they cost (§12-А.5).
   */
  async receive(documentId: string, userId: string): Promise<TransferWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.findOne(documentId);
      const locked = await this.repository.lock(tx, documentId);
      if (!locked) {
        throw new NotFoundException('Transfer not found');
      }
      if (locked.tstatus !== transfer_status.SENT) {
        throw new ConflictException(
          `${document.doc_number} is ${locked.tstatus}: only a SENT transfer can be received (§12-А.4)`,
        );
      }

      const transfer = await this.requireTransfer(tx, documentId);
      await this.warehouses.requireActive(transfer.to_warehouse, tx);

      for (const item of transfer.warehouse_transfer_items) {
        await this.stock.addToWarehouse(tx, {
          layerId: item.layer_id,
          warehouseId: transfer.to_warehouse,
          qty: item.qty,
          documentId,
          movementType: stock_movement_type.TRANSFER_IN,
        });
      }

      await this.repository.setStatus(tx, documentId, {
        tstatus: transfer_status.RECEIVED,
        receivedBy: userId,
      });

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'warehouse_transfers',
          entityId: documentId,
          action: 'TRANSFER_RECEIVED',
          newValue: { to_warehouse: transfer.to_warehouse },
        },
        tx,
      );

      return this.requireTransfer(tx, documentId);
    });
  }

  findOne(documentId: string, db: Db = this.prisma): Promise<TransferWithItems> {
    return this.requireTransfer(db, documentId);
  }

  findMany(filter: { status?: transfer_status }) {
    return this.repository.findMany(filter);
  }

  /** Sent but not received — a Day Close blocker (Period Lock pre-check). */
  inFlight(db: Db = this.prisma) {
    return this.repository.inFlight(db);
  }

  private async requireTransfer(
    db: Db,
    documentId: string,
  ): Promise<TransferWithItems> {
    const transfer = await this.repository.findById(db, documentId);
    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }
    return transfer;
  }
}
