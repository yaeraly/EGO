import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { documents, receipt_expenses, receipt_status, user_role } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateExpenseDto,
  CreateReceiptDto,
  SetRatesDto,
  UpdateReceiptLinesDto,
} from './dto/receipt.dto';
import { CostingView, toCostingView } from './landed-cost';
import { ReceiptProblem } from './receipt-validation';
import { ReceiptFull } from './receipts.repository';
import { ReceiptsService } from './receipts.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  purchase_id?: string;

  @IsOptional()
  @IsEnum(receipt_status)
  status?: receipt_status;
}

/**
 * Receipt (RCV) — §7.
 *
 * Receiving goods is warehouse work, so it is not OWNER-only; what is
 * OWNER-only is overriding a rate or splitting an expense by hand (§9.6).
 */
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post()
  create(
    @Body() dto: CreateReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.receipts.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto) {
    return this.receipts.findMany({
      purchaseId: query.purchase_id,
      status: query.status,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReceiptFull> {
    return this.receipts.findOne(id);
  }

  /** What actually arrived, and how much of it is damaged (§8.1, §8.4). */
  @Post(':id/lines')
  updateLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReceiptLinesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceiptFull> {
    return this.receipts.updateLines(id, dto, user.id);
  }

  @Post(':id/expenses')
  addExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<receipt_expenses> {
    return this.receipts.addExpense(id, dto, user.id);
  }

  @Delete(':id/expenses/:expenseId')
  removeExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.receipts.removeExpense(id, expenseId, user.id);
  }

  /** What §10.1 would choose, shown before it is fixed. */
  @Get(':id/rate-suggestion')
  suggestRates(@Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.suggestRates(id);
  }

  /** Overriding a rate is the OWNER's call, and is recorded as MANUAL. */
  @Roles(user_role.OWNER)
  @Post(':id/rates')
  setRates(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRatesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceiptFull> {
    return this.receipts.setRates(id, dto, user.id);
  }

  /** Everything blocking confirmation, each naming its product and field. */
  @Get(':id/problems')
  problems(@Param('id', ParseUUIDPipe) id: string): Promise<ReceiptProblem[]> {
    return this.receipts.problems(id);
  }

  /** The landed cost this receipt would fix, without fixing it (§9.7). */
  @Get(':id/preview')
  async preview(@Param('id', ParseUUIDPipe) id: string): Promise<CostingView> {
    return toCostingView(await this.receipts.preview(id));
  }

  @Post(':id/ready')
  markReady(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceiptFull> {
    return this.receipts.markReady(id, user.id);
  }
}
