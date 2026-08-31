import { Injectable } from '@nestjs/common';
import { product_aliases } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductAliasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: {
    productId: string;
    alias: string;
    kind: string;
  }): Promise<product_aliases> {
    return this.prisma.product_aliases.create({
      data: { product_id: data.productId, alias: data.alias, kind: data.kind },
    });
  }

  findForProduct(productId: string, db: Db = this.prisma): Promise<product_aliases[]> {
    return db.product_aliases.findMany({
      where: { product_id: productId },
      orderBy: [{ kind: 'asc' }, { alias: 'asc' }],
    });
  }

  findById(id: string): Promise<product_aliases | null> {
    return this.prisma.product_aliases.findUnique({ where: { id } });
  }

  findSame(productId: string, alias: string): Promise<product_aliases | null> {
    return this.prisma.product_aliases.findFirst({
      where: { product_id: productId, alias: { equals: alias, mode: 'insensitive' } },
    });
  }

  delete(id: string): Promise<product_aliases> {
    return this.prisma.product_aliases.delete({ where: { id } });
  }

  /** Aliases for a set of products, for a search result list. */
  async forProducts(ids: string[]): Promise<Map<string, product_aliases[]>> {
    const rows = await this.prisma.product_aliases.findMany({
      where: { product_id: { in: ids } },
      orderBy: [{ kind: 'asc' }, { alias: 'asc' }],
    });
    const byProduct = new Map<string, product_aliases[]>();
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }
    return byProduct;
  }
}
