import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { user_role, warehouses } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { WarehousesService } from './warehouses.service';

/** OWNER maintains the warehouse list; everyone reads it (§12-А.1). */
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateWarehouseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<warehouses> {
    return this.warehouses.create(dto, user.id);
  }

  @Get()
  findAll(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<warehouses[]> {
    return this.warehouses.findAll(includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<warehouses> {
    return this.warehouses.findOne(id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<warehouses> {
    return this.warehouses.update(id, dto, user.id);
  }
}
