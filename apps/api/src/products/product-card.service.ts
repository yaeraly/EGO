import { Injectable } from '@nestjs/common';
import { Prisma, product_aliases, products } from '@prisma/client';
import { CategoriesService } from '../categories/categories.service';
import { Db } from '../common/db';
import { money } from '../common/money-json';
import { PrismaService } from '../prisma/prisma.service';
import { LayerView, ProductStock, StockService } from '../stock/stock.service';
import { ProductAliasesRepository } from './product-aliases.repository';
import { ProductCardRepository } from './product-card.repository';
import { ProductsService } from './products.service';

const ZERO = new Prisma.Decimal(0);

export interface ProductCard {
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    unit: string;
    barcode: string | null;
    oem_code: string | null;
    description: string | null;
    compatibility_notes: string | null;
    is_active: boolean;
    weight_kg: string | null;
    length_cm: string | null;
    width_cm: string | null;
    height_cm: string | null;
    volume_m3: string | null;
    chargeable_weight_kg: string | null;
  };
  category: { id: string; name: string; default_warranty_days: number } | null;
  aliases: { id: string; alias: string; kind: string }[];
  /** §12-Б.7: the product's own term, or the category's when it sets none. */
  warranty: {
    days: number;
    source: 'PRODUCT' | 'CATEGORY' | 'NONE';
  };
  /** §12-Б.4 — every figure here is computed, never typed in (§12-Б.9.3). */
  stock: {
    current_qty: string;
    reserved_qty: string;
    available_qty: string;
    total_value_kgs: string;
    inbound_qty: string;
    min_stock: string;
    reorder_point: string;
    below_minimum: boolean;
    needs_reorder: boolean;
    by_warehouse: ProductStock['by_warehouse'];
  };
  /** Active FIFO layers with their remaining qty and landed cost (§12-Б.4). */
  layers: LayerView[];
  /** §12-Б.5 — read from the purchase documents, not stored on the card. */
  purchasing: {
    main_supplier: { id: string; name: string } | null;
    supplier_product_code: string | null;
    last_purchase: {
      document_id: string;
      doc_number: string;
      business_date: string;
      price_cny: string;
      qty: string;
    } | null;
    last_receipt_date: string | null;
  };
  /** §12-Б.6 — what a sale would start from today. */
  pricing: {
    base_markup_pct: string | null;
    min_selling_price: string | null;
    /** FIFO cost of the next unit out of MAIN; null when there is no stock. */
    current_fifo_cost: string | null;
    /** base markup applied to that cost, before the customer's own markup. */
    indicative_price: string | null;
  };
}

/**
 * Product Master card (§12-Б).
 *
 * Everything the card shows beyond the product's own columns is derived:
 * stock from the movements, purchase history from the orders, cost from the
 * FIFO layers. §12-Б.9.3–4 forbid editing any of it here, and computing it
 * rather than storing it is what makes that impossible rather than merely
 * disallowed.
 */
@Injectable()
export class ProductCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly aliases: ProductAliasesRepository,
    private readonly categories: CategoriesService,
    private readonly stock: StockService,
    private readonly repository: ProductCardRepository,
  ) {}

  async card(id: string, db: Db = this.prisma): Promise<ProductCard> {
    const product = await this.products.findOne(id);

    const [category, aliases, stockRows, layers, lastPurchase, lastReceipt, inbound, fifoCost] =
      await Promise.all([
        product.category_id
          ? this.categories.findOne(product.category_id, db).catch(() => null)
          : Promise.resolve(null),
        this.aliases.findForProduct(id, db),
        this.stock.stockByProduct({ productId: id }, db),
        this.stock.layersForProduct(id, db),
        this.repository.lastPurchase(db, id),
        this.repository.lastReceiptDate(db, id),
        this.repository.inboundQty(db, id),
        this.stock.oldestUnitCost(id, undefined, db),
      ]);

    const supplier = product.main_supplier_id
      ? await db.suppliers.findUnique({
          where: { id: product.main_supplier_id },
          select: { id: true, name: true },
        })
      : null;

    const held = stockRows[0];
    const current = new Prisma.Decimal(held?.current_qty ?? 0);
    const available = new Prisma.Decimal(held?.available_qty ?? 0);

    return {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        unit: product.unit,
        barcode: product.barcode,
        oem_code: product.oem_code,
        description: product.description,
        compatibility_notes: product.compatibility_notes,
        is_active: product.is_active,
        weight_kg: product.weight_kg?.toFixed(3) ?? null,
        length_cm: money(product.length_cm),
        width_cm: money(product.width_cm),
        height_cm: money(product.height_cm),
        volume_m3: product.volume_m3?.toFixed(4) ?? null,
        chargeable_weight_kg: product.chargeable_weight_kg?.toFixed(3) ?? null,
      },
      category: category
        ? {
            id: category.id,
            name: category.name,
            default_warranty_days: category.default_warranty_days,
          }
        : null,
      aliases: aliases.map(asAlias),
      warranty: warrantyOf(product, category?.default_warranty_days ?? null),
      stock: {
        current_qty: current.toFixed(2),
        reserved_qty: held?.reserved_qty ?? '0.00',
        available_qty: available.toFixed(2),
        total_value_kgs: held?.total_value_kgs ?? '0.00',
        inbound_qty: inbound.toFixed(2),
        min_stock: product.min_stock.toFixed(2),
        reorder_point: product.reorder_point.toFixed(2),
        // Both read "available", not "current": stock sitting in DEFECT cannot
        // answer a customer, so it must not silence a shortage warning.
        below_minimum: available.lessThan(product.min_stock),
        needs_reorder:
          product.reorder_point.greaterThan(ZERO) &&
          available.plus(inbound).lessThanOrEqualTo(product.reorder_point),
        by_warehouse: held?.by_warehouse ?? [],
      },
      layers,
      purchasing: {
        main_supplier: supplier,
        supplier_product_code: product.supplier_product_code,
        last_purchase: lastPurchase
          ? {
              document_id: lastPurchase.document_id,
              doc_number: lastPurchase.doc_number,
              business_date: isoDate(lastPurchase.business_date),
              price_cny: lastPurchase.price_cny.toFixed(2),
              qty: lastPurchase.qty.toFixed(2),
            }
          : null,
        last_receipt_date: lastReceipt ? isoDate(lastReceipt) : null,
      },
      pricing: {
        base_markup_pct: money(product.base_markup_pct),
        min_selling_price: money(product.min_selling_price),
        current_fifo_cost: fifoCost?.toFixed(4) ?? null,
        indicative_price: indicativePrice(fifoCost, product.base_markup_pct),
      },
    };
  }
}

function asAlias(row: product_aliases): { id: string; alias: string; kind: string } {
  return { id: row.id, alias: row.alias, kind: row.kind };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * §12-Б.7 — the product's own term wins when it has one.
 *
 * 0 on the product is a deliberate "no warranty" (§36-А.1 names small parts
 * as exactly that case), so only NULL falls through to the category.
 */
function warrantyOf(
  product: products,
  categoryDefault: number | null,
): ProductCard['warranty'] {
  if (product.warranty_days !== null) {
    return { days: product.warranty_days, source: 'PRODUCT' };
  }
  if (categoryDefault !== null) {
    return { days: categoryDefault, source: 'CATEGORY' };
  }
  return { days: 0, source: 'NONE' };
}

/**
 * The product's own markup on today's FIFO cost (§12-Б.6, §13).
 *
 * Indicative only: the price an actual sale offers adds the customer's
 * Type × Category markup, which needs a customer. The sale screen remains the
 * one place a real price is produced.
 */
function indicativePrice(
  cost: Prisma.Decimal | null,
  baseMarkupPct: Prisma.Decimal | null,
): string | null {
  if (!cost) {
    return null;
  }
  const markup = baseMarkupPct ?? ZERO;
  return cost
    .times(markup.dividedBy(100).plus(1))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
