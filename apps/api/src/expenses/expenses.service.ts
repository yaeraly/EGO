import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, doc_type, documents, expense_categories } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal, toOptionalDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  UpdateExpenseCategoryDto,
} from './dto/expense.dto';

const ZERO = new Prisma.Decimal(0);

export type ExpenseFull = Prisma.expensesGetPayload<{
  include: {
    expense_categories: true;
    payment_accounts: true;
    documents: true;
  };
}>;

/**
 * Operating expenses (EXP) — §26.
 *
 * The line §26 draws matters more than the module: freight that belongs to a
 * particular batch is *not* an expense. It is part of what those goods cost,
 * and §9 allocates it into the landed cost. Only spending that belongs to no
 * batch — rent, internet, stationery, a taxi with no consignment attached —
 * is an operating expense. Booking batch freight here would understate stock
 * and overstate this month's costs at the same time.
 */
@Injectable()
export class ExpensesService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.EXP;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  // ── categories ────────────────────────────────────────────────────────

  async createCategory(
    dto: CreateExpenseCategoryDto,
    userId: string,
  ): Promise<expense_categories> {
    const name = dto.name.trim();
    const existing = await this.prisma.expense_categories.findUnique({
      where: { name },
    });
    if (existing) {
      throw new ConflictException(`«${name}» категориясы мурдатан бар (§26)`);
    }

    const budget = toOptionalDecimal(dto.monthly_budget, 'monthly_budget');
    if (budget?.isNegative()) {
      throw new BadRequestException('Бюджет терс болбойт');
    }

    const category = await this.prisma.expense_categories.create({
      data: { name, monthly_budget: budget ?? null },
    });

    await this.audit.log({
      userId,
      entity: 'expense_categories',
      entityId: category.id,
      action: 'EXPENSE_CATEGORY_CREATED',
      newValue: {
        name: category.name,
        monthly_budget: category.monthly_budget?.toFixed(2) ?? null,
      },
    });

    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateExpenseCategoryDto,
    userId: string,
  ): Promise<expense_categories> {
    const before = await this.requireCategory(id);

    const name = dto.name?.trim();
    if (name && name !== before.name) {
      const clash = await this.prisma.expense_categories.findUnique({
        where: { name },
      });
      if (clash) {
        throw new ConflictException(`«${name}» категориясы мурдатан бар (§26)`);
      }
    }

    const budget = toOptionalDecimal(dto.monthly_budget, 'monthly_budget');
    if (budget?.isNegative()) {
      throw new BadRequestException('Бюджет терс болбойт');
    }

    const category = await this.prisma.expense_categories.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(dto.monthly_budget === undefined ? {} : { monthly_budget: budget }),
      },
    });

    await this.audit.log({
      userId,
      entity: 'expense_categories',
      entityId: id,
      action: 'EXPENSE_CATEGORY_UPDATED',
      oldValue: {
        name: before.name,
        monthly_budget: before.monthly_budget?.toFixed(2) ?? null,
      },
      newValue: {
        name: category.name,
        monthly_budget: category.monthly_budget?.toFixed(2) ?? null,
      },
    });

    return category;
  }

  findCategories(): Promise<expense_categories[]> {
    return this.prisma.expense_categories.findMany({ orderBy: { name: 'asc' } });
  }

  // ── the expense itself ────────────────────────────────────────────────

  async create(dto: CreateExpenseDto, userId: string): Promise<documents> {
    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('Чыгым оң сумма болушу керек');
    }

    await this.requireCategory(dto.category_id);

    const account = await this.accounts.findOne(dto.account_id);
    if (!account.is_active) {
      throw new BadRequestException(`${account.name} эсеби активдүү эмес`);
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.EXP,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment.trim(),
      });

      await tx.expenses.create({
        data: {
          document_id: document.id,
          category_id: dto.category_id,
          account_id: dto.account_id,
          amount,
        },
      });

      return document;
    });
  }

  /** Confirming pays it: money out, and the account may not go negative. */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const expense = await tx.expenses.findUnique({
      where: { document_id: document.id },
      include: { expense_categories: true },
    });
    if (!expense) {
      throw new NotFoundException(
        `Expense body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      expense.account_id,
    );
    await this.accounts.postMovement(tx, {
      accountId: expense.account_id,
      documentId: document.id,
      amount: expense.amount.negated(),
      kgsValue: null,
      currentBalance: balance,
      accountName: account.name,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'expenses',
        entityId: document.id,
        action: 'EXPENSE_CONFIRMED',
        newValue: {
          category: expense.expense_categories.name,
          amount: expense.amount.toFixed(2),
          account_id: expense.account_id,
          currency: account.currency,
        },
        reason: document.comment,
      },
      tx,
    );
  }

  findMany(filter: {
    categoryId?: string;
    from?: Date;
    to?: Date;
  }): Promise<ExpenseFull[]> {
    return this.prisma.expenses.findMany({
      where: {
        ...(filter.categoryId ? { category_id: filter.categoryId } : {}),
        ...(filter.from || filter.to
          ? {
              documents: {
                business_date: {
                  ...(filter.from ? { gte: filter.from } : {}),
                  ...(filter.to ? { lte: filter.to } : {}),
                },
              },
            }
          : {}),
      },
      include: {
        expense_categories: true,
        payment_accounts: true,
        documents: true,
      },
      orderBy: { documents: { business_date: 'desc' } },
      take: 200,
    });
  }

  findOne(id: string, db: Db = this.prisma): Promise<ExpenseFull> {
    return this.requireExpense(db, id);
  }

  /**
   * What each category has cost this month, against its budget (§26).
   *
   * Confirmed documents only — a draft is a plan, not a cost. The ceiling
   * reports rather than refuses: §26 offers a warning, and an expense the
   * business has actually paid is a fact whether or not it fits a budget.
   */
  async monthlySpend(month: Date = new Date()): Promise<
    {
      category_id: string;
      name: string;
      monthly_budget: string | null;
      spent: string;
      remaining: string | null;
      over_budget: boolean;
    }[]
  > {
    const from = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
    );
    const to = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
    );

    const rows = await this.prisma.$queryRaw<
      { category_id: string; spent: Prisma.Decimal }[]
    >`
      SELECT e.category_id, SUM(e.amount) AS spent
      FROM expenses e
      JOIN documents d ON d.id = e.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date >= ${from}
        AND d.business_date < ${to}
      GROUP BY e.category_id
    `;
    const spentBy = new Map(rows.map((row) => [row.category_id, row.spent]));

    const categories = await this.findCategories();
    return categories.map((category) => {
      const spent = spentBy.get(category.id) ?? ZERO;
      const budget = category.monthly_budget;
      return {
        category_id: category.id,
        name: category.name,
        monthly_budget: budget?.toFixed(2) ?? null,
        spent: spent.toFixed(2),
        remaining: budget ? budget.minus(spent).toFixed(2) : null,
        over_budget: budget ? spent.greaterThan(budget) : false,
      };
    });
  }

  private async requireCategory(id: string): Promise<expense_categories> {
    const category = await this.prisma.expense_categories.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException('Чыгым категориясы табылган жок');
    }
    return category;
  }

  private async requireExpense(db: Db, id: string): Promise<ExpenseFull> {
    const expense = await db.expenses.findUnique({
      where: { document_id: id },
      include: {
        expense_categories: true,
        payment_accounts: true,
        documents: true,
      },
    });
    if (!expense) {
      throw new NotFoundException('Чыгым табылган жок');
    }
    return expense;
  }
}
