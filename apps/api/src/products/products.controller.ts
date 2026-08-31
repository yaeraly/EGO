import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { product_aliases, products, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateAliasDto } from './dto/alias.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductCard, ProductCardService } from './product-card.service';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly cards: ProductCardService,
  ) {}

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

  /** The whole §12-Б card: stock, purchase history, cost and warranty. */
  @Get(':id/card')
  card(@Param('id', ParseUUIDPipe) id: string): Promise<ProductCard> {
    return this.cards.card(id);
  }

  @Get(':id/aliases')
  aliases(@Param('id', ParseUUIDPipe) id: string): Promise<product_aliases[]> {
    return this.products.listAliases(id);
  }

  @Roles(user_role.OWNER)
  @Post(':id/aliases')
  addAlias(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAliasDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<product_aliases> {
    return this.products.addAlias(id, dto, user.id);
  }

  @Roles(user_role.OWNER)
  @Delete(':id/aliases/:aliasId')
  @HttpCode(204)
  removeAlias(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aliasId', ParseUUIDPipe) aliasId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.products.removeAlias(id, aliasId, user.id);
  }
}
