import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { claim_status, claim_type, claims, user_role } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClaimsService } from './claims.service';
import {
  CompensateClaimDto,
  CreateClaimDto,
  UpdateClaimStatusDto,
} from './dto/claim.dto';

class ListQueryDto {
  @IsOptional()
  @IsEnum(claim_status)
  status?: claim_status;

  @IsOptional()
  @IsEnum(claim_type)
  ctype?: claim_type;
}

/** Claim (CLM) — §8.5, §8.7. Claiming a loss back is the OWNER's business. */
@Roles(user_role.OWNER)
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  create(
    @Body() dto: CreateClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<claims> {
    return this.claims.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto) {
    return this.claims.findMany({ status: query.status, ctype: query.ctype });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.claims.findOne(id);
  }

  /** Money back, or goods in a later batch (§8.7). */
  @Post(':id/compensations')
  compensate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompensateClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<claims> {
    return this.claims.compensate(id, dto, user.id);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClaimStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<claims> {
    return this.claims.setStatus(id, dto, user.id, user.role);
  }
}
