import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type HandoverFull = Prisma.handover_actsGetPayload<{
  include: { handover_checked_items: true; documents: true };
}>;

@Injectable()
export class HandoversRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      fromUser: string;
      toUser: string;
      totalValue: Prisma.Decimal;
    },
  ) {
    return tx.handover_acts.create({
      data: {
        document_id: data.documentId,
        from_user: data.fromUser,
        to_user: data.toUser,
        total_value: data.totalValue,
      },
    });
  }

  insertItems(
    tx: Prisma.TransactionClient,
    handoverId: string,
    items: {
      productId: string;
      isAClass: boolean;
      systemQty: Prisma.Decimal;
    }[],
  ) {
    return tx.handover_checked_items.createMany({
      data: items.map((item) => ({
        handover_id: handoverId,
        product_id: item.productId,
        is_a_class: item.isAClass,
        system_qty: item.systemQty,
        actual_qty: item.systemQty,
      })),
    });
  }

  findById(db: Db, id: string): Promise<HandoverFull | null> {
    return db.handover_acts.findUnique({
      where: { document_id: id },
      include: { handover_checked_items: true, documents: true },
    });
  }

  findMany(filter: { userId?: string }): Promise<HandoverFull[]> {
    return this.prisma.handover_acts.findMany({
      where: filter.userId
        ? { OR: [{ from_user: filter.userId }, { to_user: filter.userId }] }
        : {},
      include: { handover_checked_items: true, documents: true },
      orderBy: { documents: { created_at: 'desc' } },
      take: 100,
    });
  }

  updateItem(
    tx: Prisma.TransactionClient,
    itemId: string,
    actualQty: Prisma.Decimal,
  ) {
    return tx.handover_checked_items.update({
      where: { id: itemId },
      data: { actual_qty: actualQty },
    });
  }

  sign(
    tx: Prisma.TransactionClient,
    id: string,
    side: 'from' | 'to',
    at: Date,
  ) {
    return tx.handover_acts.update({
      where: { document_id: id },
      data:
        side === 'from' ? { from_confirmed_at: at } : { to_confirmed_at: at },
    });
  }

  setDifference(
    tx: Prisma.TransactionClient,
    id: string,
    difference: Prisma.Decimal,
  ) {
    return tx.handover_acts.update({
      where: { document_id: id },
      data: { difference },
    });
  }
}
