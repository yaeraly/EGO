import { Injectable } from '@nestjs/common';
import { Prisma, products } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: Prisma.productsUncheckedCreateInput): Promise<products> {
    return this.prisma.products.create({ data });
  }

  findById(db: Db, id: string): Promise<products | null> {
    return db.products.findUnique({ where: { id } });
  }

  findManyByIds(db: Db, ids: string[]): Promise<products[]> {
    return db.products.findMany({ where: { id: { in: ids } } });
  }

  search(params: {
    query?: string;
    includeInactive: boolean;
  }): Promise<products[]> {
    const text = params.query?.trim();
    return this.prisma.products.findMany({
      where: {
        ...(params.includeInactive ? {} : { is_active: true }),
        ...(text
          ? {
              OR: [
                { sku: { contains: text, mode: 'insensitive' } },
                { name: { contains: text, mode: 'insensitive' } },
                { barcode: { contains: text, mode: 'insensitive' } },
                { oem_code: { contains: text, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { sku: 'asc' },
      take: 200,
    });
  }

  update(id: string, data: Prisma.productsUncheckedUpdateInput): Promise<products> {
    return this.prisma.products.update({ where: { id }, data });
  }
}
