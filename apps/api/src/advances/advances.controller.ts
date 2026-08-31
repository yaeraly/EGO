import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { documents } from '@prisma/client';
import { Request } from 'express';
import { IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AdvancesService } from './advances.service';
import { CreateAdvanceDto, RefundAdvanceDto } from './dto/advance.dto';

class ListQueryDto {
  @IsUUID()
  customer_id!: string;
}

/** Customer advance (ADV) — §17-А. */
@Controller('advances')
export class AdvancesController {
  constructor(private readonly advances: AdvancesService) {}

  /** Creates a DRAFT. Confirming it takes the money in (§17-А.1). */
  @Post()
  create(
    @Body() dto: CreateAdvanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.advances.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto) {
    return this.advances.listFor(query.customer_id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.advances.findOne(id);
  }

  @Get(':id/refunds')
  refunds(@Param('id', ParseUUIDPipe) id: string) {
    return this.advances.refundLines(id);
  }

  /** §17-А.4 — debt first, then cash, and always a PIN. */
  @Post(':id/refund')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundAdvanceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.advances.refund(id, dto, user.id, request.ip);
  }
}
