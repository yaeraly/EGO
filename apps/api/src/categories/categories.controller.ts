import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { product_categories, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CategoriesService, CategoryView } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

/** Reference data: the OWNER maintains it, everyone reads it (§2). */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<product_categories> {
    return this.categories.create(dto, user.id);
  }

  @Get()
  findAll(): Promise<CategoryView[]> {
    return this.categories.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<product_categories> {
    return this.categories.findOne(id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<product_categories> {
    return this.categories.update(id, dto, user.id);
  }

  @Roles(user_role.OWNER)
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.categories.remove(id, user.id);
  }
}
