import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoriesService } from './inventories.service';
import { InventoryFull } from './inventories.repository';

const ZERO = new Prisma.Decimal(0);

export interface InventoryView {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  warehouse: { id: string; code: string; name: string };
  is_full: boolean;
  lines: {
    id: string;
    product_id: string;
    sku: string;
    name: string;
    system_qty: string;
    actual_qty: string;
    diff_qty: string;
    layer_id: string | null;
    responsible: string | null;
  }[];
  /** How far the count has got, so the sheet can say what is left. */
  counted_lines: number;
  total_lines: number;
  shortage_lines: number;
  excess_lines: number;
}

@Injectable()
export class InventoriesViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventories: InventoriesService,
  ) {}

  async list(filter: { warehouseId?: string }): Promise<InventoryView[]> {
    const rows = await this.inventories.findMany(filter);
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async one(id: string): Promise<InventoryView> {
    return this.toView(await this.inventories.findOne(id));
  }

  private async toView(inventory: InventoryFull): Promise<InventoryView> {
    const products = await this.prisma.products.findMany({
      where: {
        id: { in: inventory.inventory_lines.map((line) => line.product_id) },
      },
      select: { id: true, sku: true, name: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    const lines = inventory.inventory_lines
      .map((line) => ({
        id: line.id,
        product_id: line.product_id,
        sku: byId.get(line.product_id)?.sku ?? '(removed)',
        name: byId.get(line.product_id)?.name ?? '(removed)',
        system_qty: line.system_qty.toFixed(2),
        actual_qty: line.actual_qty.toFixed(2),
        diff_qty: line.diff_qty.toFixed(2),
        layer_id: line.layer_id,
        responsible: line.responsible,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku));

    return {
      document: {
        id: inventory.document_id,
        doc_number: inventory.documents.doc_number,
        status: inventory.documents.status,
        business_date: inventory.documents.business_date
          .toISOString()
          .slice(0, 10),
        comment: inventory.documents.comment,
      },
      warehouse: {
        id: inventory.warehouses.id,
        code: inventory.warehouses.code,
        name: inventory.warehouses.name,
      },
      is_full: inventory.is_full,
      lines,
      counted_lines: inventory.inventory_lines.filter(
        (line) => line.responsible !== null,
      ).length,
      total_lines: inventory.inventory_lines.length,
      shortage_lines: inventory.inventory_lines.filter((line) =>
        line.diff_qty.lessThan(ZERO),
      ).length,
      excess_lines: inventory.inventory_lines.filter((line) =>
        line.diff_qty.greaterThan(ZERO),
      ).length,
    };
  }
}
