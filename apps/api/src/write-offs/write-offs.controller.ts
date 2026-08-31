import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { documents } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ConfirmWriteOffDto,
  CreateOtherIncomeDto,
  CreateWriteOffDto,
} from './dto/write-off.dto';
import { WriteOffFull, WriteOffsService } from './write-offs.service';

/** Write-off (WOF) and scrap income (OIN) — §38. */
@Controller('write-offs')
export class WriteOffsController {
  constructor(private readonly writeOffs: WriteOffsService) {}

  @Post()
  create(
    @Body() dto: CreateWriteOffDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.writeOffs.create(dto, user.id);
  }

  @Get()
  findMany(): Promise<WriteOffFull[]> {
    return this.writeOffs.findMany();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<WriteOffFull> {
    return this.writeOffs.findOne(id);
  }

  /** §38 — cost written off, scrap income against it, and what it cost net. */
  @Get(':id/result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.writeOffs.defectResult(id);
  }

  /** A write-off always takes a PIN. */
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmWriteOffDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<WriteOffFull> {
    return this.writeOffs.confirm(id, dto, user.id, request.ip);
  }
}

/** Other income (OIN) — §38.7. */
@Controller('other-income')
export class OtherIncomeController {
  constructor(private readonly writeOffs: WriteOffsService) {}

  @Post()
  create(
    @Body() dto: CreateOtherIncomeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.writeOffs.createOtherIncome(dto, user.id);
  }
}
