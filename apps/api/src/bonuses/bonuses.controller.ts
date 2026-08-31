import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { bonus_status, documents, user_role } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { BonusesService } from './bonuses.service';
import { CreateBonusPaymentDto } from './dto/bonus.dto';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  employee_id?: string;

  @IsOptional()
  @IsEnum(bonus_status)
  status?: bonus_status;
}

export interface BonusView {
  id: string;
  sale_id: string;
  employee_id: string;
  revenue: string;
  fifo_cogs: string;
  bonus_base: string;
  bonus_rate: string;
  calculated_amount: string;
  adjustment_amount: string;
  payable_amount: string;
  status: bonus_status;
  calculated_at: string;
  payable_at: string | null;
  paid_at: string | null;
  payment_doc: string | null;
}

/**
 * Seller bonus (§23) and its payment (BON).
 *
 * OWNER-only: §23 leaves the rate and the payment to the OWNER, and what one
 * seller earns is not the shop floor's to read (§2).
 */
@Roles(user_role.OWNER)
@Controller('bonuses')
export class BonusesController {
  constructor(private readonly bonuses: BonusesService) {}

  @Get()
  async findMany(@Query() query: ListQueryDto): Promise<BonusView[]> {
    const rows = await this.bonuses.findMany({
      employeeId: query.employee_id,
      status: query.status,
    });
    return rows.map((row) => ({
      id: row.id,
      sale_id: row.sale_id,
      employee_id: row.employee_id,
      revenue: row.revenue.toFixed(2),
      fifo_cogs: row.fifo_cogs.toFixed(2),
      bonus_base: row.bonus_base.toFixed(2),
      bonus_rate: row.bonus_rate.toFixed(2),
      calculated_amount: row.calculated_amount.toFixed(2),
      adjustment_amount: row.adjustment_amount.toFixed(2),
      payable_amount: row.payable_amount.toFixed(2),
      status: row.bstatus,
      calculated_at: row.calculated_at.toISOString(),
      payable_at: row.payable_at?.toISOString() ?? null,
      paid_at: row.paid_at?.toISOString() ?? null,
      payment_doc: row.payment_doc,
    }));
  }

  /** What each employee has earned and what is ready to pay (§23.2). */
  @Get('standing')
  standing() {
    return this.bonuses.standing();
  }

  /** BON — the payment itself. Confirming it hands the money over. */
  @Post('payments')
  createPayment(
    @Body() dto: CreateBonusPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.bonuses.createPayment(dto, user.id);
  }
}
