import { Injectable } from '@nestjs/common';
import { Prisma, advance_status } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export type AdvanceFull = Prisma.advancesGetPayload<{
  include: { customers: true; documents_advances_document_idTodocuments: true };
}>;

@Injectable()
export class AdvancesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      customerId: string;
      reservationId: string | null;
      accountId: string;
      amount: Prisma.Decimal;
    },
  ) {
    return tx.advances.create({
      data: {
        document_id: data.documentId,
        customer_id: data.customerId,
        reservation_id: data.reservationId,
        account_id: data.accountId,
        amount: data.amount,
        astatus: advance_status.ACTIVE,
      },
    });
  }

  findById(db: Db, id: string): Promise<AdvanceFull | null> {
    return db.advances.findUnique({
      where: { document_id: id },
      include: {
        customers: true,
        documents_advances_document_idTodocuments: true,
      },
    });
  }

  /**
   * Advances that still hold money for this customer, oldest first.
   *
   * Oldest first for the same reason §16-А.1 settles the oldest debt first:
   * money that has been sitting longest is applied first, and neither side
   * has to choose.
   */
  liveFor(db: Db, customerId: string): Promise<AdvanceFull[]> {
    return db.advances.findMany({
      where: {
        customer_id: customerId,
        astatus: {
          in: [advance_status.ACTIVE, advance_status.PARTIALLY_APPLIED],
        },
        documents_advances_document_idTodocuments: { status: 'CONFIRMED' },
      },
      include: {
        customers: true,
        documents_advances_document_idTodocuments: true,
      },
      orderBy: {
        documents_advances_document_idTodocuments: { created_at: 'asc' },
      },
    });
  }

  setAmounts(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      appliedAmount?: Prisma.Decimal;
      refundedAmount?: Prisma.Decimal;
      status: advance_status;
    },
  ) {
    return tx.advances.update({
      where: { document_id: id },
      data: {
        ...(data.appliedAmount ? { applied_amount: data.appliedAmount } : {}),
        ...(data.refundedAmount ? { refunded_amount: data.refundedAmount } : {}),
        astatus: data.status,
      },
    });
  }

  insertRefundLines(
    tx: Prisma.TransactionClient,
    advanceId: string,
    lines: {
      accountId: string | null;
      saleId: string | null;
      amount: Prisma.Decimal;
      sourceOverrideReason: string | null;
    }[],
  ) {
    return tx.advance_refund_lines.createMany({
      data: lines.map((line) => ({
        advance_id: advanceId,
        account_id: line.accountId,
        sale_id: line.saleId,
        amount: line.amount,
        source_override_reason: line.sourceOverrideReason,
      })),
    });
  }

  refundLines(db: Db, advanceId: string) {
    return db.advance_refund_lines.findMany({
      where: { advance_id: advanceId },
      orderBy: { id: 'asc' },
    });
  }

  forReservation(db: Db, reservationId: string): Promise<AdvanceFull[]> {
    return db.advances.findMany({
      where: {
        reservation_id: reservationId,
        documents_advances_document_idTodocuments: { status: 'CONFIRMED' },
      },
      include: {
        customers: true,
        documents_advances_document_idTodocuments: true,
      },
    });
  }
}
