import { Injectable } from '@nestjs/common';
import { Prisma, debt_status } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenSaleDebt {
  sale_id: string;
  doc_number: string;
  business_date: Date;
  total_amount: Prisma.Decimal;
  paid_amount: Prisma.Decimal;
  outstanding_amount: Prisma.Decimal;
  debt_due_date: Date | null;
  debt_status: debt_status | null;
  salesperson: string;
}

@Injectable()
export class CreditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The customer's open debts, oldest first.
   *
   * Oldest-first is not presentation: it is the order §16-А.1 allocates a
   * payment in, and the order §16.6 reports the oldest unpaid due date from.
   * Only confirmed sales carry debt — a draft has sold nothing.
   */
  openDebts(db: Db, customerId: string): Promise<OpenSaleDebt[]> {
    return db.$queryRaw`
      SELECT s.document_id AS sale_id, d.doc_number, d.business_date,
             s.total_amount, s.paid_amount, s.outstanding_amount,
             s.debt_due_date, s.debt_status, s.salesperson
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE s.customer_id = ${customerId}::uuid
        AND d.status = 'CONFIRMED'
        AND s.outstanding_amount > 0
      ORDER BY d.business_date ASC, d.created_at ASC
    `;
  }

  /**
   * The same list, with every debt row locked.
   *
   * Taken before a credit check that a sale then relies on, so a concurrent
   * payment or sale cannot change the balance underneath it.
   */
  lockOpenDebts(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<OpenSaleDebt[]> {
    return tx.$queryRaw`
      SELECT s.document_id AS sale_id, d.doc_number, d.business_date,
             s.total_amount, s.paid_amount, s.outstanding_amount,
             s.debt_due_date, s.debt_status, s.salesperson
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE s.customer_id = ${customerId}::uuid
        AND d.status = 'CONFIRMED'
        AND s.outstanding_amount > 0
      ORDER BY d.business_date ASC, d.created_at ASC
      FOR UPDATE OF s
    `;
  }

  insertOverride(
    tx: Prisma.TransactionClient,
    data: {
      customerId: string;
      saleId: string | null;
      ownerId: string;
      reason: string;
      openDebt: Prisma.Decimal;
      overdueAmount: Prisma.Decimal;
      creditLimit: Prisma.Decimal;
      newDebt: Prisma.Decimal;
      projectedDebt: Prisma.Decimal;
    },
  ) {
    return tx.credit_overrides.create({
      data: {
        customer_id: data.customerId,
        sale_id: data.saleId,
        owner_id: data.ownerId,
        reason: data.reason,
        open_debt: data.openDebt,
        overdue_amount: data.overdueAmount,
        credit_limit: data.creditLimit,
        new_debt: data.newDebt,
        projected_debt: data.projectedDebt,
      },
    });
  }

  overridesForCustomer(customerId: string) {
    return this.prisma.credit_overrides.findMany({
      where: { customer_id: customerId },
      orderBy: { created_at: 'desc' },
    });
  }

  /** Debts that fell due before today and are still open (§16.4). */
  overdueDebts(db: Db, today: Date) {
    return db.sales.findMany({
      where: {
        outstanding_amount: { gt: 0 },
        debt_due_date: { lt: today },
        documents_sales_document_idTodocuments: { status: 'CONFIRMED' },
      },
      include: {
        documents_sales_document_idTodocuments: {
          select: { doc_number: true, business_date: true },
        },
        customers: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { debt_due_date: 'asc' },
    });
  }

  /** Debts falling due within the warning window (§16). */
  dueSoon(db: Db, from: Date, to: Date) {
    return db.sales.findMany({
      where: {
        outstanding_amount: { gt: 0 },
        debt_due_date: { gte: from, lte: to },
        documents_sales_document_idTodocuments: { status: 'CONFIRMED' },
      },
      include: {
        documents_sales_document_idTodocuments: { select: { doc_number: true } },
        customers: { select: { id: true, name: true } },
        users_sales_salespersonTousers: { select: { id: true, full_name: true } },
      },
      orderBy: { debt_due_date: 'asc' },
    });
  }
}
