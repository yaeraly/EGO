import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { documents } from '@prisma/client';
import { Request } from 'express';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ConfirmInventoryDto,
  CountDto,
  CreateInventoryDto,
} from './dto/inventory.dto';
import { InventoriesService } from './inventories.service';
import { InventoriesViewService, InventoryView } from './inventories-view.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  warehouse_id?: string;
}

/** Inventory (INV) — §22. */
@Controller('inventories')
export class InventoriesController {
  constructor(
    private readonly inventories: InventoriesService,
    private readonly view: InventoriesViewService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateInventoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.inventories.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto): Promise<InventoryView[]> {
    return this.view.list({ warehouseId: query.warehouse_id });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<InventoryView> {
    return this.view.one(id);
  }

  /** Records what was counted; the difference follows from it. */
  @Patch(':id/count')
  async count(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InventoryView> {
    await this.inventories.count(id, dto, user.id);
    return this.view.one(id);
  }

  /** The Inventory Adjustment: OWNER only, PIN always, reason always (§22). */
  @Post(':id/confirm')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmInventoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<InventoryView> {
    await this.inventories.confirm(id, dto, user, request.ip);
    return this.view.one(id);
  }
}
