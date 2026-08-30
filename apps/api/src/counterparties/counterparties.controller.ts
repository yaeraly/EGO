import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { cargo_companies, suppliers, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CargoCompaniesService, SuppliersService } from './counterparties.service';
import {
  CreateCargoCompanyDto,
  CreateSupplierDto,
  UpdateCargoCompanyDto,
  UpdateSupplierDto,
} from './dto/counterparty.dto';

/** OWNER writes reference data; a salesperson reads it (§2). */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<suppliers> {
    return this.suppliers.create(dto, user.id);
  }

  @Get()
  findAll(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<suppliers[]> {
    return this.suppliers.findAll(includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<suppliers> {
    return this.suppliers.findOne(id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<suppliers> {
    return this.suppliers.update(id, dto, user.id);
  }
}

@Controller('cargo-companies')
export class CargoCompaniesController {
  constructor(private readonly companies: CargoCompaniesService) {}

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateCargoCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<cargo_companies> {
    return this.companies.create(dto, user.id);
  }

  @Get()
  findAll(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<cargo_companies[]> {
    return this.companies.findAll(includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<cargo_companies> {
    return this.companies.findOne(id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCargoCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<cargo_companies> {
    return this.companies.update(id, dto, user.id);
  }
}
