import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, account_type, currency_code, payment_accounts } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

export interface AccountBalance {
  account_id: string;
  name: string;
  type: account_type;
  currency: currency_code;
  is_active: boolean;
  /** Decimal string, exact to the stored scale. */
  balance: string;
}

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateAccountDto, userId: string): Promise<payment_accounts> {
    if (dto.owner_user) {
      const owner = await this.prisma.users.findUnique({
        where: { id: dto.owner_user },
        select: { id: true },
      });
      if (!owner) {
        throw new NotFoundException('owner_user does not exist');
      }
    }

    const account = await this.prisma.payment_accounts.create({
      data: {
        name: dto.name,
        type: dto.type,
        currency: dto.currency,
        owner_user: dto.owner_user ?? null,
      },
    });

    await this.audit.log({
      userId,
      entity: 'payment_accounts',
      entityId: account.id,
      action: 'ACCOUNT_CREATED',
      newValue: {
        name: account.name,
        type: account.type,
        currency: account.currency,
        owner_user: account.owner_user,
      },
    });

    return account;
  }

  findAll(includeInactive = false): Promise<payment_accounts[]> {
    return this.prisma.payment_accounts.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: [{ currency: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string): Promise<payment_accounts> {
    const account = await this.prisma.payment_accounts.findUnique({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  /**
   * Only the name, owner and active flag are editable.
   *
   * Currency and type are fixed at creation: movements already booked to the
   * account were recorded in its currency, so changing it would silently
   * reinterpret history. A wrong currency means a new account.
   */
  async update(
    id: string,
    dto: UpdateAccountDto,
    userId: string,
  ): Promise<payment_accounts> {
    const before = await this.findOne(id);

    if (dto.is_active === false) {
      await this.assertClosable(id);
    }

    const account = await this.prisma.payment_accounts.update({
      where: { id },
      data: {
        name: dto.name,
        owner_user: dto.owner_user,
        is_active: dto.is_active,
      },
    });

    await this.audit.log({
      userId,
      entity: 'payment_accounts',
      entityId: id,
      action: 'ACCOUNT_UPDATED',
      oldValue: {
        name: before.name,
        owner_user: before.owner_user,
        is_active: before.is_active,
      },
      newValue: {
        name: account.name,
        owner_user: account.owner_user,
        is_active: account.is_active,
      },
    });

    return account;
  }

  /**
   * An account holding money cannot be deactivated: its balance would vanish
   * from every active-account report while the money is still real. Transfer
   * it out first.
   */
  private async assertClosable(id: string): Promise<void> {
    const balance = await this.balance(id);
    if (!balance.isZero()) {
      throw new ConflictException(
        `Account still holds ${balance.toFixed(2)}; transfer it out before deactivating`,
      );
    }
  }

  /** Balance is SUM(account_movements.amount) — never a stored running total. */
  async balance(accountId: string): Promise<Prisma.Decimal> {
    const { _sum } = await this.prisma.account_movements.aggregate({
      where: { account_id: accountId },
      _sum: { amount: true },
    });
    return _sum.amount ?? ZERO;
  }

  async balances(includeInactive = false): Promise<AccountBalance[]> {
    const accounts = await this.findAll(includeInactive);
    const sums = await this.prisma.account_movements.groupBy({
      by: ['account_id'],
      _sum: { amount: true },
    });
    const byAccount = new Map(
      sums.map((s) => [s.account_id, s._sum.amount ?? ZERO]),
    );

    return accounts.map((account) => ({
      account_id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      is_active: account.is_active,
      balance: (byAccount.get(account.id) ?? ZERO).toFixed(2),
    }));
  }

  /**
   * Locks the account row and returns its balance.
   *
   * The lock is what makes the balance safe to act on: without it two
   * concurrent withdrawals each read a sufficient balance and both post,
   * leaving the account overdrawn. Holding the row for the rest of the
   * transaction serializes every movement on that account.
   */
  async lockBalance(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<{ account: payment_accounts; balance: Prisma.Decimal }> {
    const [account] = await tx.$queryRaw<payment_accounts[]>`
      SELECT * FROM payment_accounts WHERE id = ${accountId}::uuid FOR UPDATE
    `;
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const [{ balance }] = await tx.$queryRaw<{ balance: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(amount), 0) AS balance
      FROM account_movements
      WHERE account_id = ${accountId}::uuid
    `;

    return { account, balance: balance ?? ZERO };
  }

  /**
   * Locks several accounts in a fixed order.
   *
   * Two transfers moving money in opposite directions between the same pair of
   * accounts would deadlock if each locked its own "from" account first.
   * Sorting the ids gives every transaction the same acquisition order.
   */
  async lockBalances(
    tx: Prisma.TransactionClient,
    accountIds: string[],
  ): Promise<Map<string, { account: payment_accounts; balance: Prisma.Decimal }>> {
    const ordered = [...new Set(accountIds)].sort();
    const locked = new Map<
      string,
      { account: payment_accounts; balance: Prisma.Decimal }
    >();
    for (const id of ordered) {
      locked.set(id, await this.lockBalance(tx, id));
    }
    return locked;
  }

  /**
   * Records a movement. Positive is money in, negative is money out.
   *
   * Every movement belongs to a document — there is no manual bookkeeping
   * entry (§27, §42.3). An outgoing movement is refused if it would overdraw
   * the account (§42.5, §10-А.4); the caller must already hold the account
   * lock, or the check races.
   */
  async postMovement(
    tx: Prisma.TransactionClient,
    params: {
      accountId: string;
      documentId: string;
      amount: Prisma.Decimal;
      kgsValue?: Prisma.Decimal | null;
      currentBalance: Prisma.Decimal;
      accountName: string;
    },
  ): Promise<void> {
    if (params.amount.isZero()) {
      throw new BadRequestException('A movement of zero has no meaning');
    }

    const resulting = params.currentBalance.plus(params.amount);
    if (resulting.isNegative()) {
      throw new ConflictException(
        `${params.accountName} holds ${params.currentBalance.toFixed(2)}, ` +
          `which is not enough for ${params.amount.abs().toFixed(2)}`,
      );
    }

    await tx.account_movements.create({
      data: {
        account_id: params.accountId,
        document_id: params.documentId,
        amount: params.amount,
        kgs_value: params.kgsValue ?? null,
      },
    });
  }
}
