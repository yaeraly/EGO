import { Injectable } from '@nestjs/common';
import { Prisma, account_type, currency_code, payment_accounts } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: {
    name: string;
    type: account_type;
    currency: currency_code;
    ownerUser: string | null;
  }): Promise<payment_accounts> {
    return this.prisma.payment_accounts.create({
      data: {
        name: data.name,
        type: data.type,
        currency: data.currency,
        owner_user: data.ownerUser,
      },
    });
  }

  findById(db: Db, id: string): Promise<payment_accounts | null> {
    return db.payment_accounts.findUnique({ where: { id } });
  }

  findMany(includeInactive: boolean): Promise<payment_accounts[]> {
    return this.prisma.payment_accounts.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: [{ currency: 'asc' }, { name: 'asc' }],
    });
  }

  update(
    id: string,
    data: { name?: string; owner_user?: string; is_active?: boolean },
  ): Promise<payment_accounts> {
    return this.prisma.payment_accounts.update({ where: { id }, data });
  }

  /** Balance is SUM(account_movements.amount) — never a stored running total. */
  async balance(id: string): Promise<Prisma.Decimal> {
    const { _sum } = await this.prisma.account_movements.aggregate({
      where: { account_id: id },
      _sum: { amount: true },
    });
    return _sum.amount ?? ZERO;
  }

  async balancesByAccount(): Promise<Map<string, Prisma.Decimal>> {
    const sums = await this.prisma.account_movements.groupBy({
      by: ['account_id'],
      _sum: { amount: true },
    });
    return new Map(sums.map((s) => [s.account_id, s._sum.amount ?? ZERO]));
  }

  /**
   * Takes the account row and holds it for the rest of the transaction.
   *
   * The lock is what makes a balance safe to act on: without it two concurrent
   * withdrawals each read a sufficient balance and both post (§42.5).
   */
  async lockAccount(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<payment_accounts | undefined> {
    const [account] = await tx.$queryRaw<payment_accounts[]>`
      SELECT * FROM payment_accounts WHERE id = ${id}::uuid FOR UPDATE
    `;
    return account;
  }

  async balanceInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Prisma.Decimal> {
    const [{ balance }] = await tx.$queryRaw<{ balance: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(amount), 0) AS balance
      FROM account_movements
      WHERE account_id = ${id}::uuid
    `;
    return balance ?? ZERO;
  }

  /** Every movement belongs to a document — there is no manual entry (§27). */
  async insertMovement(
    tx: Prisma.TransactionClient,
    data: {
      accountId: string;
      documentId: string;
      amount: Prisma.Decimal;
      kgsValue: Prisma.Decimal | null;
    },
  ): Promise<void> {
    await tx.account_movements.create({
      data: {
        account_id: data.accountId,
        document_id: data.documentId,
        amount: data.amount,
        kgs_value: data.kgsValue,
      },
    });
  }
}
