import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { documents, transfer_status } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateTransferDto } from './dto/warehouse-transfer.dto';
import { TransferWithItems } from './warehouse-transfers.repository';
import { WarehouseTransfersService } from './warehouse-transfers.service';

class ListQueryDto {
  @IsOptional()
  @IsEnum(transfer_status)
  status?: transfer_status;
}

/** Warehouse Transfer (TRF) — §12-А.4. */
@Controller('warehouse-transfers')
export class WarehouseTransfersController {
  constructor(private readonly transfers: WarehouseTransfersService) {}

  /**
   * Creates a DRAFT. Confirming the document sends it (goods leave); the
   * receiving warehouse then calls `receive`.
   */
  @Post()
  create(
    @Body() dto: CreateTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.transfers.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto) {
    return this.transfers.findMany({ status: query.status });
  }

  /** Sent but not yet received — what blocks a day close. */
  @Get('in-flight')
  inFlight() {
    return this.transfers.inFlight();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TransferWithItems> {
    return this.transfers.findOne(id);
  }

  @Post(':id/receive')
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferWithItems> {
    return this.transfers.receive(id, user.id);
  }
}
