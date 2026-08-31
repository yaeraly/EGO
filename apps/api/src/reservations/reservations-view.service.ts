import { Injectable } from '@nestjs/common';
import { Prisma, reservation_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { AdvanceRequirement } from './reservation-policy';
import { ReservationFull } from './reservations.repository';
import { ReservationsService } from './reservations.service';

const ZERO = new Prisma.Decimal(0);

export interface ReservationView {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  customer: { id: string; name: string };
  salesperson: string;
  status: reservation_status;
  /** True while the hold actually stands (§17.3). */
  is_live: boolean;
  expires_at: string;
  total_amount: string;
  advance_required: string;
  advance_paid: string;
  /** What still has to be paid before §17.3 considers the hold fully backed. */
  advance_outstanding: string;
  cancel_reason: string | null;
  fulfilled_sale: string | null;
  items: {
    product_id: string;
    sku: string;
    name: string;
    qty: string;
    fixed_price: string;
    line_total: string;
  }[];
}

/** The reservation as a screen needs it — §17.3's audit list, assembled. */
@Injectable()
export class ReservationsViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
    private readonly products: ProductsService,
  ) {}

  async list(filter: {
    customerId?: string;
    status?: reservation_status;
    salesperson?: string;
  }): Promise<ReservationView[]> {
    const rows = await this.reservations.findMany(filter);
    const paid = await this.advancePaidFor(rows.map((row) => row.document_id));
    return Promise.all(rows.map((row) => this.toView(row, paid)));
  }

  async one(id: string): Promise<ReservationView> {
    const reservation = await this.reservations.findOne(id);
    const paid = await this.advancePaidFor([id]);
    return this.toView(reservation, paid);
  }

  /** Advance requirement recomputed, for a screen that has to explain it. */
  requirement(reservation: ReservationFull): Promise<AdvanceRequirement> {
    return this.reservations.requirementFor(reservation);
  }

  /**
   * Advance money actually standing behind each reservation.
   *
   * What has been refunded no longer backs the hold, and what has been applied
   * to a sale has already done its work — so the figure is the amount still
   * held as a liability against this reservation (§17-А).
   */
  private async advancePaidFor(
    ids: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.advances.findMany({
      where: {
        reservation_id: { in: ids },
        documents_advances_document_idTodocuments: { status: 'CONFIRMED' },
      },
      select: {
        reservation_id: true,
        amount: true,
        applied_amount: true,
        refunded_amount: true,
      },
    });

    const byReservation = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      if (!row.reservation_id) continue;
      const held = row.amount.minus(row.refunded_amount);
      byReservation.set(
        row.reservation_id,
        (byReservation.get(row.reservation_id) ?? ZERO).plus(held),
      );
    }
    return byReservation;
  }

  private async toView(
    reservation: ReservationFull,
    paidByReservation: Map<string, Prisma.Decimal>,
  ): Promise<ReservationView> {
    const products = await this.prisma.products.findMany({
      where: {
        id: { in: reservation.reservation_items.map((item) => item.product_id) },
      },
      select: { id: true, sku: true, name: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const paid = paidByReservation.get(reservation.document_id) ?? ZERO;

    return {
      document: {
        id: reservation.document_id,
        doc_number: reservation.documents.doc_number,
        status: reservation.documents.status,
        business_date: reservation.documents.business_date
          .toISOString()
          .slice(0, 10),
        comment: reservation.documents.comment,
      },
      customer: {
        id: reservation.customers.id,
        name: reservation.customers.name,
      },
      salesperson: reservation.salesperson,
      status: reservation.rstatus,
      is_live: this.reservations.isLive(reservation),
      expires_at: reservation.expires_at.toISOString(),
      total_amount: reservation.total_amount.toFixed(2),
      advance_required: reservation.advance_required.toFixed(2),
      advance_paid: paid.toFixed(2),
      advance_outstanding: Prisma.Decimal.max(
        reservation.advance_required.minus(paid),
        ZERO,
      ).toFixed(2),
      cancel_reason: reservation.cancel_reason,
      fulfilled_sale: reservation.fulfilled_sale,
      items: reservation.reservation_items.map((item) => ({
        product_id: item.product_id,
        sku: byId.get(item.product_id)?.sku ?? '(removed)',
        name: byId.get(item.product_id)?.name ?? '(removed)',
        qty: item.qty.toFixed(2),
        fixed_price: item.fixed_price.toFixed(2),
        line_total: item.qty
          .times(item.fixed_price)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(2),
      })),
    };
  }
}
