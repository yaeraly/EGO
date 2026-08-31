import { Injectable } from '@nestjs/common';
import { Prisma, reservation_status } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type ReservationFull = Prisma.reservationsGetPayload<{
  include: {
    reservation_items: true;
    customers: true;
    documents: true;
  };
}>;

@Injectable()
export class ReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      customerId: string;
      salesperson: string;
      expiresAt: Date;
      totalAmount: Prisma.Decimal;
      advanceRequired: Prisma.Decimal;
    },
  ) {
    return tx.reservations.create({
      data: {
        document_id: data.documentId,
        customer_id: data.customerId,
        salesperson: data.salesperson,
        expires_at: data.expiresAt,
        total_amount: data.totalAmount,
        advance_required: data.advanceRequired,
      },
    });
  }

  insertItems(
    tx: Prisma.TransactionClient,
    reservationId: string,
    items: { productId: string; qty: Prisma.Decimal; fixedPrice: Prisma.Decimal }[],
  ) {
    return tx.reservation_items.createMany({
      data: items.map((item) => ({
        reservation_id: reservationId,
        product_id: item.productId,
        qty: item.qty,
        fixed_price: item.fixedPrice,
      })),
    });
  }

  findById(db: Db, id: string): Promise<ReservationFull | null> {
    return db.reservations.findUnique({
      where: { document_id: id },
      include: {
        reservation_items: true,
        customers: true,
        documents: true,
      },
    });
  }

  findMany(filter: {
    customerId?: string;
    status?: reservation_status;
    salesperson?: string;
  }): Promise<ReservationFull[]> {
    return this.prisma.reservations.findMany({
      where: {
        ...(filter.customerId ? { customer_id: filter.customerId } : {}),
        ...(filter.status ? { rstatus: filter.status } : {}),
        ...(filter.salesperson ? { salesperson: filter.salesperson } : {}),
      },
      include: {
        reservation_items: true,
        customers: true,
        documents: true,
      },
      orderBy: { expires_at: 'asc' },
      take: 200,
    });
  }

  setStatus(
    tx: Prisma.TransactionClient,
    id: string,
    status: reservation_status,
    extra: { cancelReason?: string; fulfilledSale?: string } = {},
  ) {
    return tx.reservations.update({
      where: { document_id: id },
      data: {
        rstatus: status,
        ...(extra.cancelReason ? { cancel_reason: extra.cancelReason } : {}),
        ...(extra.fulfilledSale ? { fulfilled_sale: extra.fulfilledSale } : {}),
      },
    });
  }

  /**
   * Live reservations this customer holds (§17.3).
   *
   * Counted the same way stock counts them: confirmed, still ACTIVE and not
   * yet past its expiry, so the limit does not include holds that have
   * already released their goods.
   */
  async activeCountForCustomer(db: Db, customerId: string): Promise<number> {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM reservations r
      JOIN documents d ON d.id = r.document_id
      WHERE r.customer_id = ${customerId}::uuid
        AND r.rstatus = 'ACTIVE'
        AND d.status = 'CONFIRMED'
        AND r.expires_at > now()
    `;
    return Number(row?.count ?? 0);
  }

  /** Confirmed reservations whose time has run out (§17.3). */
  expired(db: Db): Promise<ReservationFull[]> {
    return db.reservations.findMany({
      where: {
        rstatus: reservation_status.ACTIVE,
        expires_at: { lte: new Date() },
        documents: { status: 'CONFIRMED' },
      },
      include: {
        reservation_items: true,
        customers: true,
        documents: true,
      },
    });
  }
}
