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
import { IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ConfirmReturnDto, CreateReturnDto } from './dto/return.dto';
import { ReturnView, ReturnsViewService } from './returns-view.service';
import { ReturnsService } from './returns.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsUUID()
  original_sale?: string;
}

/** Return (RET) — §35. */
@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly view: ReturnsViewService,
  ) {}

  /** Creates a DRAFT. Confirming it moves the goods and the money. */
  @Post()
  create(
    @Body() dto: CreateReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.returns.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto): Promise<ReturnView[]> {
    return this.view.list({
      customerId: query.customer_id,
      originalSale: query.original_sale,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReturnView> {
    return this.view.one(id);
  }

  /** What confirming would settle — the debt first, the rest in cash (§35.4). */
  @Get(':id/settlement')
  settlement(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ debt_offset: string; cash_refund: string }> {
    return this.returns.settlement(id);
  }

  /** PIN always; §36-А.2 adds the OWNER's signature once warranty has run out. */
  @Post(':id/confirm')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReturnDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ReturnView> {
    await this.returns.confirm(id, dto, user, request.ip);
    return this.view.one(id);
  }
}
