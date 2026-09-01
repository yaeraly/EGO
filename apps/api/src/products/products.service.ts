import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, product_aliases, products } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal, toOptionalDecimal } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAliasDto } from './dto/alias.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductAliasesRepository } from './product-aliases.repository';
import {
  formatBarcode,
  formatSku,
  normalisePrefix,
} from './product-codes';
import { ProductsRepository } from './products.repository';

/** The barcode counter is its own: a barcode names a product, not a category. */
const BARCODE_SEQUENCE = '__barcode__';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ProductsRepository,
    private readonly aliases: ProductAliasesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a product, and gives it its codes.
   *
   * The SKU and the barcode are the system's to issue (§12-Б.9.1): a code
   * typed by hand is eventually mistyped or repeated, and neither shows up
   * until a receipt or a sale reaches the wrong part. Both are allocated in
   * the same transaction as the row, so a failed creation leaves no gap a
   * later product would silently fill.
   */
  async create(dto: CreateProductDto, userId: string): Promise<products> {
    let product: products;
    try {
      product = await this.prisma.$transaction(async (tx) => {
        const codes = await this.issueCodes(tx, dto.category_id ?? null);
        return this.repository.insert(
          {
            sku: codes.sku,
            barcode: codes.barcode,
            name: dto.name,
            category_id: dto.category_id ?? null,
            brand: dto.brand ?? null,
            unit: dto.unit ?? 'даана',
            oem_code: dto.oem_code ?? null,
            weight_kg: toOptionalDecimal(dto.weight_kg, 'weight_kg'),
            length_cm: toOptionalDecimal(dto.length_cm, 'length_cm'),
            width_cm: toOptionalDecimal(dto.width_cm, 'width_cm'),
            height_cm: toOptionalDecimal(dto.height_cm, 'height_cm'),
            volume_m3: toOptionalDecimal(dto.volume_m3, 'volume_m3'),
            chargeable_weight_kg: toOptionalDecimal(
              dto.chargeable_weight_kg,
              'chargeable_weight_kg',
            ),
            base_markup_pct: toOptionalDecimal(
              dto.base_markup_pct,
              'base_markup_pct',
            ),
            min_selling_price: toOptionalDecimal(
              dto.min_selling_price,
              'min_selling_price',
            ),
            purchase_price_cny: toOptionalDecimal(
              dto.purchase_price_cny,
              'purchase_price_cny',
            ),
            main_supplier_id: dto.main_supplier_id ?? null,
            supplier_product_code: dto.supplier_product_code ?? null,
            description: dto.description ?? null,
            warranty_days: dto.warranty_days ?? null,
            compatibility_notes: dto.compatibility_notes ?? null,
            ...(dto.min_stock === undefined
              ? {}
              : { min_stock: toDecimal(dto.min_stock, 'min_stock') }),
            ...(dto.reorder_point === undefined
              ? {}
              : { reorder_point: toDecimal(dto.reorder_point, 'reorder_point') }),
          },
          tx,
        );
      });
    } catch (error) {
      throw this.translateSkuConflict(error);
    }

    await this.audit.log({
      userId,
      entity: 'products',
      entityId: product.id,
      action: 'PRODUCT_CREATED',
      newValue: {
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
      },
    });

    return product;
  }

  /**
   * The next SKU and barcode.
   *
   * The SKU takes the category's own code as its prefix, so "MOT-00042" says
   * what it is across a warehouse; a category without one falls back to PRD.
   * Each prefix counts separately, and the row is taken FOR UPDATE, so two
   * products created at the same moment queue rather than collide.
   *
   * The barcode is an in-store EAN-13 from the 20-29 range GS1 reserves for
   * exactly this, on a counter of its own — it identifies the product, not
   * its category, and must not change if the category does.
   */
  private async issueCodes(
    tx: Prisma.TransactionClient,
    categoryId: string | null,
  ): Promise<{ sku: string; barcode: string }> {
    const category = categoryId
      ? await tx.product_categories.findUnique({ where: { id: categoryId } })
      : null;
    const prefix = normalisePrefix(category?.code);

    const [sequence, barcodeSequence] = await Promise.all([
      this.nextSequence(tx, prefix),
      this.nextSequence(tx, BARCODE_SEQUENCE),
    ]);

    return {
      sku: formatSku(prefix, sequence),
      barcode: formatBarcode(barcodeSequence),
    };
  }

  private async nextSequence(
    tx: Prisma.TransactionClient,
    prefix: string,
  ): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO product_sequences (prefix, last_number)
      VALUES (${prefix}, 0)
      ON CONFLICT (prefix) DO NOTHING
    `;
    const [row] = await tx.$queryRaw<{ last_number: number }[]>`
      SELECT last_number FROM product_sequences
      WHERE prefix = ${prefix}
      FOR UPDATE
    `;
    const next = row.last_number + 1;
    await tx.$executeRaw`
      UPDATE product_sequences SET last_number = ${next} WHERE prefix = ${prefix}
    `;
    return next;
  }

  search(params: {
    query?: string;
    includeInactive?: boolean;
    modelId?: string;
    verifiedOnly?: boolean;
  }): Promise<products[]> {
    return this.repository.search({
      query: params.query,
      includeInactive: params.includeInactive ?? false,
      modelId: params.modelId,
      verifiedOnly: params.verifiedOnly,
    });
  }

  async findOne(id: string): Promise<products> {
    const product = await this.repository.findById(this.prisma, id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /**
   * Resolves the products a Purchase's lines point at, in one query.
   *
   * Refuses the whole set if any id is unknown or inactive: a purchase line
   * naming a product nobody sells is a data-entry mistake, and letting it
   * through would surface as a broken Receipt weeks later.
   */
  async requireActive(db: Db, ids: string[]): Promise<Map<string, products>> {
    const unique = [...new Set(ids)];
    const found = await this.repository.findManyByIds(db, unique);
    const byId = new Map(found.map((p) => [p.id, p]));

    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown product: ${missing.join(', ')}`);
    }

    const inactive = found.filter((p) => !p.is_active);
    if (inactive.length > 0) {
      throw new ConflictException(
        `Product is not active: ${inactive.map((p) => p.sku).join(', ')}`,
      );
    }

    return byId;
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    userId: string,
  ): Promise<products> {
    const before = await this.findOne(id);

    const product = await this.repository.update(id, {
      name: dto.name,
      category_id: dto.category_id,
      brand: dto.brand,
      unit: dto.unit,
      // sku and barcode are the system's, not the form's: a product keeps the
      // codes it was issued for as long as it exists (§12-Б.9.1).
      oem_code: dto.oem_code,
      weight_kg: toOptionalDecimal(dto.weight_kg, 'weight_kg'),
      length_cm: toOptionalDecimal(dto.length_cm, 'length_cm'),
      width_cm: toOptionalDecimal(dto.width_cm, 'width_cm'),
      height_cm: toOptionalDecimal(dto.height_cm, 'height_cm'),
      volume_m3: toOptionalDecimal(dto.volume_m3, 'volume_m3'),
      chargeable_weight_kg: toOptionalDecimal(
        dto.chargeable_weight_kg,
        'chargeable_weight_kg',
      ),
      base_markup_pct: toOptionalDecimal(dto.base_markup_pct, 'base_markup_pct'),
      purchase_price_cny: toOptionalDecimal(
        dto.purchase_price_cny,
        'purchase_price_cny',
      ),
      min_selling_price: toOptionalDecimal(
        dto.min_selling_price,
        'min_selling_price',
      ),
      main_supplier_id: dto.main_supplier_id,
      supplier_product_code: dto.supplier_product_code,
      description: dto.description,
      warranty_days: dto.warranty_days,
      compatibility_notes: dto.compatibility_notes,
      // min_stock and reorder_point are NOT NULL with a default, so an absent
      // field must leave the stored value alone rather than write null.
      ...(dto.min_stock === undefined
        ? {}
        : { min_stock: toDecimal(dto.min_stock, 'min_stock') }),
      ...(dto.reorder_point === undefined
        ? {}
        : { reorder_point: toDecimal(dto.reorder_point, 'reorder_point') }),
      is_active: dto.is_active,
      updated_at: new Date(),
    });

    await this.audit.log({
      userId,
      entity: 'products',
      entityId: id,
      action: 'PRODUCT_UPDATED',
      oldValue: { name: before.name, is_active: before.is_active },
      newValue: { name: product.name, is_active: product.is_active },
    });

    return product;
  }


  /**
   * Alternative names (§12-Б.2).
   *
   * One part is called different things by the market, the mechanic and the
   * Chinese supplier; each name recorded here is one more way the person at
   * the counter finds it (§12-Б.9.6).
   */
  async addAlias(
    productId: string,
    dto: CreateAliasDto,
    userId: string,
  ): Promise<product_aliases> {
    await this.findOne(productId);
    const alias = dto.alias.trim();

    const existing = await this.aliases.findSame(productId, alias);
    if (existing) {
      throw new ConflictException(`«${alias}» бул товарда мурдатан бар (§12-Б.2)`);
    }

    const row = await this.aliases.insert({
      productId,
      alias,
      kind: dto.kind ?? 'OTHER',
    });

    await this.audit.log({
      userId,
      entity: 'product_aliases',
      entityId: row.id,
      action: 'PRODUCT_ALIAS_ADDED',
      newValue: { product_id: productId, alias: row.alias, kind: row.kind },
    });

    return row;
  }

  async listAliases(productId: string): Promise<product_aliases[]> {
    await this.findOne(productId);
    return this.aliases.findForProduct(productId);
  }

  async removeAlias(
    productId: string,
    aliasId: string,
    userId: string,
  ): Promise<void> {
    const alias = await this.aliases.findById(aliasId);
    if (!alias || alias.product_id !== productId) {
      throw new NotFoundException('Альтернативдүү аталыш табылган жок');
    }

    await this.aliases.delete(aliasId);

    await this.audit.log({
      userId,
      entity: 'product_aliases',
      entityId: aliasId,
      action: 'PRODUCT_ALIAS_REMOVED',
      oldValue: { product_id: productId, alias: alias.alias, kind: alias.kind },
    });
  }

  private translateSkuConflict(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('sku is already in use');
    }
    return error;
  }
}
