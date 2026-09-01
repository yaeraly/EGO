import { Injectable } from '@nestjs/common';
import { Prisma, product_categories } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: Prisma.product_categoriesCreateInput): Promise<product_categories> {
    return this.prisma.product_categories.create({ data });
  }

  findById(id: string, db: Db = this.prisma): Promise<product_categories | null> {
    return db.product_categories.findUnique({ where: { id } });
  }

  findByName(name: string): Promise<product_categories | null> {
    return this.prisma.product_categories.findUnique({ where: { name } });
  }

  /** The SKU prefix is unique when set, so a code names one category. */
  findByCode(code: string): Promise<product_categories | null> {
    return this.prisma.product_categories.findFirst({ where: { code } });
  }

  findAll(): Promise<product_categories[]> {
    return this.prisma.product_categories.findMany({ orderBy: { name: 'asc' } });
  }

  update(
    id: string,
    data: Prisma.product_categoriesUpdateInput,
  ): Promise<product_categories> {
    return this.prisma.product_categories.update({ where: { id }, data });
  }

  delete(id: string): Promise<product_categories> {
    return this.prisma.product_categories.delete({ where: { id } });
  }

  /** How many products point at this category — none may be orphaned. */
  countProducts(id: string): Promise<number> {
    return this.prisma.products.count({ where: { category_id: id } });
  }

  /** Product counts for the whole list, without a query per row. */
  async productCounts(): Promise<Map<string, number>> {
    const rows = await this.prisma.products.groupBy({
      by: ['category_id'],
      _count: { _all: true },
      where: { category_id: { not: null } },
    });
    return new Map(
      rows.map((row) => [row.category_id as string, row._count._all]),
    );
  }
}
