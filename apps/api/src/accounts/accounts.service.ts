import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, account_type, currency_code, payment_accounts } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AccountsRepository } from './accounts.repository';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

export interface AccountBalance {
  account_id: string;
  name: string;
  type: account_type;
  currency: currency_code;
  /** Whose till it is (§19); null for a company-wide account. */
  owner_user: string | null;
  is_active: boolean;
  /** Decimal string, exact to the stored scale. */
  balance: string;
}

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AccountsRepository,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateAccountDto, userId: string): Promise<payment_accounts> {
    if (dto.owner_user) {
      await this.users.requireExists(dto.owner_user);
    }

    const account = await this.repository.insert({
      name: dto.name,
      type: dto.type,
      currency: dto.currency,
      ownerUser: dto.owner_user ?? null,
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
    return this.repository.findMany(includeInactive);
  }

  /** Null instead of throwing, so callers can word their own error. */
  findOptional(id: string): Promise<payment_accounts | null> {
    return this.repository.findById(this.prisma, id);
  }

  async findOne(id: string): Promise<payment_accounts> {
    const account = await this.repository.findById(this.prisma, id);
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

    const account = await this.repository.update(id, {
      name: dto.name,
      owner_user: dto.owner_user,
      is_active: dto.is_active,
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
  balance(accountId: string): Promise<Prisma.Decimal> {
    return this.repository.balance(accountId);
  }

  async balances(includeInactive = false): Promise<AccountBalance[]> {
    const accounts = await this.findAll(includeInactive);
    const byAccount = await this.repository.balancesByAccount();

    return accounts.map((account) => ({
      account_id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      owner_user: account.owner_user,
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
    const account = await this.repository.lockAccount(tx, accountId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return {
      account,
      balance: await this.repository.balanceInTransaction(tx, accountId),
    };
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

    await this.repository.insertMovement(tx, {
      accountId: params.accountId,
      documentId: params.documentId,
      amount: params.amount,
      kgsValue: params.kgsValue ?? null,
    });
  }
}
