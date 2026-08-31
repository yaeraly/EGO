import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  customer_category,
  customer_type,
  customers,
  products,
} from '@prisma/client';
import { Db } from '../common/db';
import { roundMoney } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export interface PriceSuggestion {
  product_id: string;
  sku: string;
  name: string;
  /** What the system proposes per unit, before any manual discount (§13). */
  auto_price: string;
  /** The floor the OWNER's pricing policy sets, if any (§13.2). */
  min_selling_price: string | null;
  /** The two markups that produced it, for the screen and the audit. */
  base_markup_pct: string | null;
  extra_markup_pct: string;
  /** Unit cost the price was built from, when one could be established. */
  unit_cost: string | null;
  customer: {
    id: string;
    ctype: customer_type;
    category: customer_category;
  };
}

/** The Type × Category matrix as it is stored (§13). */
type MarkupMatrix = Partial<
  Record<customer_type, Partial<Record<customer_category, number | string>>>
>;

/**
 * Pricing (§13).
 *
 * Two levels, exactly as §13 describes them: the product carries a base
 * markup, and the customer's type and category add a second one — §13's own
 * example is a wholesale VIP paying nothing extra while a Standard retail
 * customer pays more.
 *
 * The cost the markup applies to is the FIFO cost of the oldest stock, not a
 * product-card average (§13.3). That keeps the suggested price honest about
 * what the next unit sold actually costs.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async suggest(
    params: {
      productId: string;
      customerId: string;
      warehouseId: string;
      /** Quantity the price is for; the cost is taken from those units. */
      qty?: Prisma.Decimal;
    },
    db: Db = this.prisma,
  ): Promise<PriceSuggestion> {
    const product = await db.products.findUnique({
      where: { id: params.productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const customer = await db.customers.findUnique({
      where: { id: params.customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const unitCost = await this.oldestUnitCost(
      db,
      params.productId,
      params.warehouseId,
    );
    const extra = await this.extraMarkupPct(customer);
    const base = product.base_markup_pct;

    const autoPrice = this.priceFrom(product, unitCost, base, extra);

    return {
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      auto_price: autoPrice.toFixed(2),
      min_selling_price: product.min_selling_price?.toFixed(2) ?? null,
      base_markup_pct: base?.toFixed(2) ?? null,
      extra_markup_pct: extra.toFixed(2),
      unit_cost: unitCost?.toFixed(4) ?? null,
      customer: {
        id: customer.id,
        ctype: customer.ctype,
        category: customer.category,
      },
    };
  }

  /**
   * The suggested unit price.
   *
   * Cost plus both markups, compounded — the base markup is the product's own
   * margin and the extra is what the customer's standing adds on top of it.
   * With no cost to work from, the OWNER's minimum selling price stands in;
   * with neither, there is nothing to suggest and the price has to be typed,
   * which the caller sees as 0.00 rather than a fabricated number.
   */
  private priceFrom(
    product: products,
    unitCost: Prisma.Decimal | null,
    basePct: Prisma.Decimal | null,
    extraPct: Prisma.Decimal,
  ): Prisma.Decimal {
    if (!unitCost) {
      return product.min_selling_price ?? ZERO;
    }

    const withBase = unitCost.times(HUNDRED.plus(basePct ?? ZERO)).dividedBy(HUNDRED);
    const withExtra = withBase.times(HUNDRED.plus(extraPct)).dividedBy(HUNDRED);
    const suggested = roundMoney(withExtra);

    // A policy floor beats a markup that lands under it (§13.2).
    return product.min_selling_price &&
      product.min_selling_price.greaterThan(suggested)
      ? product.min_selling_price
      : suggested;
  }

  /**
   * FIFO cost of the next unit out (§13.3).
   *
   * The oldest available layer is what a sale would consume first, so it is
   * what the price should be built on.
   */
  private async oldestUnitCost(
    db: Db,
    productId: string,
    warehouseId: string,
  ): Promise<Prisma.Decimal | null> {
    const [row] = await db.$queryRaw<{ unit_cost: Prisma.Decimal }[]>`
      SELECT l.unit_cost
      FROM layer_stock s
      JOIN fifo_layers l ON l.id = s.layer_id
      WHERE s.warehouse_id = ${warehouseId}::uuid
        AND l.product_id = ${productId}::uuid
        AND s.qty > 0
      ORDER BY l.layer_date ASC, l.created_at ASC, l.id ASC
      LIMIT 1
    `;
    return row?.unit_cost ?? null;
  }

  /**
   * The extra markup for this customer (§13).
   *
   * An unconfigured matrix means no extra markup at all — the product's own
   * base markup still applies. §13 leaves the percentages entirely to the
   * OWNER, so guessing one would price goods nobody agreed to price.
   */
  async extraMarkupPct(
    customer: Pick<customers, 'ctype' | 'category'>,
  ): Promise<Prisma.Decimal> {
    const matrix = await this.markupMatrix();
    const value = matrix?.[customer.ctype]?.[customer.category];
    if (value === undefined || value === null) {
      return ZERO;
    }

    const pct = new Prisma.Decimal(value);
    if (pct.isNegative()) {
      throw new BadRequestException(
        `${SettingKey.PRICING_MARKUP_MATRIX}: a markup cannot be negative (${customer.ctype}.${customer.category})`,
      );
    }
    return pct;
  }

  private async markupMatrix(): Promise<MarkupMatrix | null> {
    const setting = await this.settings
      .findOne(SettingKey.PRICING_MARKUP_MATRIX)
      .catch(() => null);
    if (!setting || setting.value === null || typeof setting.value !== 'object') {
      return null;
    }
    return setting.value as MarkupMatrix;
  }
}
