import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { documents, user_role } from '@prisma/client';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateSalaryDto } from './dto/salary.dto';
import { SalariesService, SalaryFull } from './salaries.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  employee_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}

export interface SalaryView {
  document_id: string;
  employee: { id: string; full_name: string };
  period: string;
  base_amount: string;
  bonus_amount: string;
  advance_amount: string;
  deduction: string;
  total_paid: string;
  account: { id: string; name: string };
  documents: { doc_number: string; status: string; business_date: string };
}

/** Money at full scale, as every money field in this API is (CLAUDE.md). */
function toView(salary: SalaryFull): SalaryView {
  return {
    document_id: salary.document_id,
    employee: { id: salary.employee_id, full_name: salary.users.full_name },
    period: `${salary.period_year}-${String(salary.period_month).padStart(2, '0')}`,
    base_amount: salary.base_amount.toFixed(2),
    bonus_amount: salary.bonus_amount.toFixed(2),
    advance_amount: salary.advance_amount.toFixed(2),
    deduction: salary.deduction.toFixed(2),
    total_paid: salary.total_paid.toFixed(2),
    account: { id: salary.account_id, name: salary.payment_accounts.name },
    documents: {
      doc_number: salary.documents.doc_number,
      status: salary.documents.status,
      business_date: salary.documents.business_date.toISOString().slice(0, 10),
    },
  };
}

/**
 * Salary payment (SLR) — §25.
 *
 * OWNER-only throughout: what each person earns is not something the shop
 * floor reads (§2), and §25 leaves the figures to the OWNER.
 */
@Roles(user_role.OWNER)
@Controller('salaries')
export class SalariesController {
  constructor(private readonly salaries: SalariesService) {}

  @Post()
  create(
    @Body() dto: CreateSalaryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.salaries.create(dto, user.id);
  }

  @Get()
  async findMany(@Query() query: ListQueryDto): Promise<SalaryView[]> {
    const rows = await this.salaries.findMany({
      employeeId: query.employee_id,
      year: query.year,
      month: query.month,
    });
    return rows.map(toView);
  }

  /** §25 — what each employee has already been paid for that month. */
  @Get('period/:year/:month')
  period(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.salaries.periodSummary(year, month);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SalaryView> {
    return toView(await this.salaries.findOne(id));
  }
}
