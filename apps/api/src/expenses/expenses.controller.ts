import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { documents, expense_categories, user_role } from '@prisma/client';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  UpdateExpenseCategoryDto,
} from './dto/expense.dto';
import { ExpenseFull, ExpensesService } from './expenses.service';

export interface ExpenseView {
  document_id: string;
  category_id: string;
  account_id: string;
  amount: string;
  expense_categories: { name: string };
  payment_accounts: { name: string; currency: string };
  documents: {
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
}

/** Money at full scale, as every money field in this API is (CLAUDE.md). */
function toView(expense: ExpenseFull): ExpenseView {
  return {
    document_id: expense.document_id,
    category_id: expense.category_id,
    account_id: expense.account_id,
    amount: expense.amount.toFixed(2),
    expense_categories: { name: expense.expense_categories.name },
    payment_accounts: {
      name: expense.payment_accounts.name,
      currency: expense.payment_accounts.currency,
    },
    documents: {
      doc_number: expense.documents.doc_number,
      status: expense.documents.status,
      business_date: expense.documents.business_date.toISOString().slice(0, 10),
      comment: expense.documents.comment,
    },
  };
}

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

class MonthQueryDto {
  /** Any date inside the month to report on; defaults to today. */
  @IsOptional()
  @IsISO8601()
  month?: string;
}

/** Operating expenses (EXP) — §26. */
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  create(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.expenses.create(dto, user.id);
  }

  @Get()
  async findMany(@Query() query: ListQueryDto): Promise<ExpenseView[]> {
    const rows = await this.expenses.findMany({
      categoryId: query.category_id,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    return rows.map(toView);
  }

  /** §26 — this month's spend per category, against the OWNER's ceiling. */
  @Get('monthly')
  monthly(@Query() query: MonthQueryDto) {
    return this.expenses.monthlySpend(
      query.month ? new Date(query.month) : undefined,
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ExpenseView> {
    return toView(await this.expenses.findOne(id));
  }
}

/** Expense categories — reference data the OWNER maintains (§2, §26). */
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  async findAll(): Promise<
    { id: string; name: string; monthly_budget: string | null }[]
  > {
    const rows = await this.expenses.findCategories();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      monthly_budget: row.monthly_budget?.toFixed(2) ?? null,
    }));
  }

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateExpenseCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<expense_categories> {
    return this.expenses.createCategory(dto, user.id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<expense_categories> {
    return this.expenses.updateCategory(id, dto, user.id);
  }
}
