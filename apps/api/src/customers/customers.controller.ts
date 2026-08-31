import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { customers, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  SetCategoryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * Customers (§11).
 *
 * A salesperson creates and finds customers — that is the job at the counter.
 * What is OWNER-only is anything that decides how much credit someone gets:
 * the individual limit (§16.1) and the manual category (§12.1).
 */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<customers> {
    if (dto.individual_credit_limit !== undefined && user.role !== user_role.OWNER) {
      throw this.customers.walkInRefusal('CREDIT_LIMIT');
    }
    return this.customers.create(dto, user.id);
  }

  /** The sale screen's autocomplete: name or phone (§14). */
  @Get()
  findMany(
    @Query('q') query?: string,
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<customers[]> {
    return this.customers.findMany({ query, includeInactive, limit });
  }

  /** The technical customer unidentified retail sales go to (§11.1). */
  @Get('walk-in')
  walkIn(): Promise<customers> {
    return this.customers.walkIn();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<customers> {
    return this.customers.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<customers> {
    if (dto.individual_credit_limit !== undefined && user.role !== user_role.OWNER) {
      throw this.customers.walkInRefusal('CREDIT_LIMIT');
    }
    return this.customers.update(id, dto, user.id);
  }

  /** A category set by hand outranks the monthly calculation (§12.1). */
  @Roles(user_role.OWNER)
  @Patch(':id/category')
  setCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<customers> {
    return this.customers.setCategory(id, dto, user.id);
  }

  @Roles(user_role.OWNER)
  @Delete(':id/category')
  clearOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<customers> {
    return this.customers.clearCategoryOverride(id, user.id);
  }
}
