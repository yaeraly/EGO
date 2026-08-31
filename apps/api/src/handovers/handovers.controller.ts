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
import { IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateHandoverDto,
  HandoverCountDto,
  SignHandoverDto,
} from './dto/handover.dto';
import { HandoverFull } from './handovers.repository';
import { HandoversService } from './handovers.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  user_id?: string;
}

/** Warehouse handover (HND) — §21. */
@Controller('handovers')
export class HandoversController {
  constructor(private readonly handovers: HandoversService) {}

  /** Opens an act; the system picks what gets counted (§21.1). */
  @Post()
  create(
    @Body() dto: CreateHandoverDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.handovers.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto): Promise<HandoverFull[]> {
    return this.handovers.findMany({ userId: query.user_id });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<HandoverFull> {
    return this.handovers.findOne(id);
  }

  @Patch(':id/count')
  count(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandoverCountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HandoverFull> {
    return this.handovers.count(id, dto, user.id);
  }

  /** One signature each; the second one moves the responsibility (§21.1). */
  @Post(':id/sign')
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignHandoverDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HandoverFull> {
    return this.handovers.sign(id, dto, user.id);
  }
}
