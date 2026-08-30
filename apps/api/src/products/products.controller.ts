import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { products, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Reference data is written by the OWNER; everyone reads it (§2). */
  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<products> {
    return this.products.create(dto, user.id);
  }

  @Get()
  search(
    @Query('q') query?: string,
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<products[]> {
    return this.products.search(query, includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<products> {
    return this.products.findOne(id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<products> {
    return this.products.update(id, dto, user.id);
  }
}
