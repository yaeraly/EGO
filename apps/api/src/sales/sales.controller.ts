import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { documents, user_role } from '@prisma/client';
import { Request } from 'express';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { clientContext } from '../common/request-context';
import { Roles } from '../common/decorators/roles.decorator';
import { CreditStanding } from '../credit/credit.service';
import { DocumentsService } from '../documents/documents.service';
import {
  ApproveDiscountDto,
  ConfirmSaleDto,
  CreateSaleDto,
  SetPaymentsDto,
} from './dto/sale.dto';
import { SaleConfirmContextHolder } from './sale-confirm.service';
import { SaleAssessment, SalesService } from './sales.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsUUID()
  salesperson?: string;

  @IsOptional()
  @IsEnum({ DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' })
  status?: string;

  /** "Менин сатууларым" — a salesperson sees their own (§2). */
  @IsOptional()
  mine?: string;
}

/** Sale (SAL) and Loss Sale (LSS) — §13–§16. */
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly documents: DocumentsService,
    private readonly confirmContext: SaleConfirmContextHolder,
  ) {}

  @Post()
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.sales.create(dto, user.id, user.role);
  }

  @Get()
  findMany(
    @Query() query: ListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // A salesperson sees their own sales unless they are the OWNER (§2).
    const salesperson =
      query.mine === 'true' || user.role !== user_role.OWNER
        ? user.id
        : query.salesperson;
    return this.sales.findMany({
      customerId: query.customer_id,
      salesperson,
      status: query.status,
    });
  }

  /** What the customer's credit looks like before anything is sold (§16.6). */
  @Get('credit/:customerId')
  credit(
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CreditStanding> {
    return this.sales.creditStanding(customerId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(id);
  }

  /** Prices, cost, blocks and whether a PIN will be asked for (§13, §16.6). */
  @Get(':id/preview')
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SaleAssessment> {
    return this.sales.preview(id, user.role);
  }

  @Post(':id/payments')
  setPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPaymentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SaleAssessment> {
    return this.sales.setPayments(id, dto.payments, dto.debt_due_date, user.id);
  }

  /** Asks the OWNER to allow a discount past the limit (§13.5). */
  @Post(':id/approval-request')
  requestApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SaleAssessment> {
    return this.sales.requestApproval(id, user.id);
  }

  @Roles(user_role.OWNER)
  @Post(':id/approval')
  decideApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDiscountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SaleAssessment> {
    return this.sales.decideApproval(id, dto, user.id, user.role);
  }

  /**
   * Confirms the sale.
   *
   * The PIN and any credit override travel with the request rather than the
   * document, so they are handed to the poster for this one confirmation and
   * never stored.
   */
  @Post(':id/confirm')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmSaleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SaleAssessment> {
    const ctx = clientContext(req);
    this.confirmContext.set(id, {
      pin: dto.pin,
      creditOverrideReason: dto.credit_override_reason,
      role: user.role,
      ip: ctx.ip,
      device: ctx.device,
    });

    try {
      await this.documents.confirm(id, user.id);
    } finally {
      // Never leave a PIN-bearing context behind for a later request.
      this.confirmContext.take(id);
    }

    return this.sales.preview(id, user.role);
  }
}
