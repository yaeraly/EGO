import { Injectable } from '@nestjs/common';
import { Prisma, warehouse_type, warehouses } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehousesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: Prisma.warehousesCreateInput): Promise<warehouses> {
    return this.prisma.warehouses.create({ data });
  }

  findById(id: string, db: Db = this.prisma): Promise<warehouses | null> {
    return db.warehouses.findUnique({ where: { id } });
  }

  findByCode(code: string): Promise<warehouses | null> {
    return this.prisma.warehouses.findUnique({ where: { code } });
  }

  findFirstOfType(wtype: warehouse_type): Promise<warehouses | null> {
    return this.prisma.warehouses.findFirst({
      where: { wtype, is_active: true },
      orderBy: { created_at: 'asc' },
    });
  }

  findAll(includeInactive: boolean): Promise<warehouses[]> {
    return this.prisma.warehouses.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: { code: 'asc' },
    });
  }

  update(id: string, data: Prisma.warehousesUpdateInput): Promise<warehouses> {
    return this.prisma.warehouses.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
    });
  }

  /** Any stock at all in this warehouse — checked before deactivating. */
  async holdsStock(id: string): Promise<boolean> {
    const row = await this.prisma.layer_stock.findFirst({
      where: { warehouse_id: id, qty: { gt: 0 } },
      select: { layer_id: true },
    });
    return row !== null;
  }
}
