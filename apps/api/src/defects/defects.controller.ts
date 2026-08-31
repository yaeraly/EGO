import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { documents } from '@prisma/client';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { DefectFull, DefectsService } from './defects.service';
import {
  CreateDefectDto,
  DEFECT_DECISIONS,
  DecideDefectDto,
  DefectDecision,
} from './dto/defect.dto';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @IsIn(DEFECT_DECISIONS)
  decision?: DefectDecision;
}

/** Defect act (DEF) — §36-А.3, §37. */
@Controller('defects')
export class DefectsController {
  constructor(private readonly defects: DefectsService) {}

  @Post()
  create(
    @Body() dto: CreateDefectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.defects.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto): Promise<DefectFull[]> {
    return this.defects.findMany({
      productId: query.product_id,
      decision: query.decision,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DefectFull> {
    return this.defects.findOne(id);
  }

  /** §37 — exchange, refund, claim or write-off, and who decided. */
  @Patch(':id/decision')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDefectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DefectFull> {
    return this.defects.decide(id, dto, user.id);
  }
}
