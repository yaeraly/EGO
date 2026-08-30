import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { documents, purchase_status, user_role } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AdvanceStatusDto,
  CreatePurchaseDto,
  ReplacePurchaseItemsDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import { LOGISTICS_SEQUENCE, stageNumber } from './logistics-status';
import { PurchaseListRow, PurchaseWithItems } from './purchases.repository';
import { PurchasesService, StageDuration } from './purchases.service';

class ListPurchasesQueryDto {
  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @IsEnum(purchase_status)
  logistics_status?: purchase_status;
}

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  /** §4.1: the OWNER places orders. A salesperson can see them. */
  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.purchases.create(dto, user.id);
  }

  /** The 16 stages in order, for the UI's timeline (§6). */
  @Get('logistics-stages')
  stages(): { stage: number; status: purchase_status }[] {
    return LOGISTICS_SEQUENCE.map((status) => ({
      stage: stageNumber(status),
      status,
    }));
  }

  @Get()
  findMany(@Query() query: ListPurchasesQueryDto): Promise<PurchaseListRow[]> {
    return this.purchases.findMany({
      supplierId: query.supplier_id,
      logisticsStatus: query.logistics_status,
    });
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseWithItems> {
    return this.purchases.findOne(id);
  }

  /** Stage timeline with the days spent at each (§6). */
  @Get(':id/status-history')
  async statusHistory(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ history: StageDuration[]; lead_time_days: number | null }> {
    await this.purchases.findOne(id);
    return {
      history: await this.purchases.stageDurations(undefined, id),
      lead_time_days: await this.purchases.leadTimeDays(id),
    };
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseWithItems> {
    return this.purchases.update(id, dto, user.id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id/items')
  replaceItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePurchaseItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseWithItems> {
    return this.purchases.replaceItems(id, dto, user.id);
  }

  /**
   * Any authenticated user may take the next stage; only the OWNER may set
   * another one (§6). The role check lives in the service, where the rule is.
   */
  @Post(':id/status')
  advanceStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ purchase: PurchaseWithItems; history: StageDuration[] }> {
    return this.purchases.advanceStatus(id, dto, user.id, user.role);
  }
}
