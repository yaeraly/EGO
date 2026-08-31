import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { discrepancies, discrepancy_status, discrepancy_type, user_role } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DiscrepanciesService } from './discrepancies.service';
import { UpdateDiscrepancyDto } from './dto/discrepancy.dto';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  receipt_id?: string;

  @IsOptional()
  @IsEnum(discrepancy_status)
  status?: discrepancy_status;

  @IsOptional()
  @IsEnum(discrepancy_type)
  dtype?: discrepancy_type;
}

/**
 * Discrepancy (DIF) — §8.
 *
 * There is no create endpoint: a DIF is raised by a receipt, never by hand,
 * and there is no delete endpoint either (§8.9).
 */
@Controller('discrepancies')
export class DiscrepanciesController {
  constructor(private readonly discrepancies: DiscrepanciesService) {}

  @Get()
  findMany(@Query() query: ListQueryDto) {
    return this.discrepancies.findMany({
      receiptId: query.receipt_id,
      status: query.status,
      dtype: query.dtype,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.discrepancies.findOneDetailed(id);
  }

  /** Reclassifying the cause decides who is claimed against (§8.4). */
  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscrepancyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<discrepancies> {
    return this.discrepancies.update(id, dto, user.id);
  }
}
