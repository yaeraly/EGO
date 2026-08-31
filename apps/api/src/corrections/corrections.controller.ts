import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { documents, user_role } from '@prisma/client';
import { Request } from 'express';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrectionFull, CorrectionsService } from './corrections.service';
import { ConfirmCorrectionDto, CreateCorrectionDto } from './dto/correction.dto';

/**
 * Correction / Reversal (COR) — §27.1, Period Lock.
 *
 * OWNER-only end to end: Period Lock says only the OWNER may start a
 * correction process and only the OWNER may confirm one.
 */
@Roles(user_role.OWNER)
@Controller('corrections')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Post()
  create(
    @Body() dto: CreateCorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.corrections.create(dto, user.id);
  }

  @Get()
  findMany(): Promise<CorrectionFull[]> {
    return this.corrections.findMany();
  }

  /** Recent documents a correction can reverse — what the screen offers. */
  @Get('correctable')
  correctable() {
    return this.corrections.correctable();
  }

  /** Can this document be corrected — and if not, what to do instead. */
  @Get('eligibility/:documentId')
  eligibility(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.corrections.eligibility(documentId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CorrectionFull> {
    return this.corrections.findOne(id);
  }

  /** A correction always takes the OWNER's PIN. */
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmCorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<CorrectionFull> {
    return this.corrections.confirm(id, dto, user, request.ip);
  }
}
