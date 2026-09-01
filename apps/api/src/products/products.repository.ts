import { Injectable } from '@nestjs/common';
import { Prisma, products } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `db` so the caller can allocate the codes and insert in one transaction. */
  insert(
    data: Prisma.productsUncheckedCreateInput,
    db: Db = this.prisma,
  ): Promise<products> {
    return db.products.create({ data });
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
    /** Only parts recorded as fitting this vehicle model (§12-Б.8). */
    modelId?: string;
    /** ...and only the ones somebody has actually checked. */
    verifiedOnly?: boolean;
  }): Promise<products[]> {
    const text = params.query?.trim();
    return this.prisma.products.findMany({
      where: {
        ...(params.includeInactive ? {} : { is_active: true }),
        // §12-Б.9.6: SKU, name, barcode, OEM code and the alternative names.
        // The same part is called different things by the market, the mechanic
        // and the Chinese supplier (§12-Б.2), so a search that only reads the
        // official name finds nothing the person actually typed.
        ...(text
          ? {
              OR: [
                { sku: { contains: text, mode: 'insensitive' } },
                { name: { contains: text, mode: 'insensitive' } },
                { barcode: { contains: text, mode: 'insensitive' } },
                { oem_code: { contains: text, mode: 'insensitive' } },
                {
                  product_aliases: {
                    some: { alias: { contains: text, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
        // §12-Б.8: "модель боюнча тетик фильтри". Narrowing to checked links
        // is what makes the filter worth trusting at the counter.
        ...(params.modelId
          ? {
              product_compatibility: {
                some: {
                  model_id: params.modelId,
                  ...(params.verifiedOnly ? { cstatus: 'VERIFIED' as const } : {}),
                },
              },
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
