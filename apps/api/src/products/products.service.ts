import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, products } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toOptionalDecimal } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ProductsRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateProductDto, userId: string): Promise<products> {
    let product: products;
    try {
      product = await this.repository.insert({
        sku: dto.sku,
        name: dto.name,
        category_id: dto.category_id ?? null,
        brand: dto.brand ?? null,
        unit: dto.unit ?? 'даана',
        barcode: dto.barcode ?? null,
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
        main_supplier_id: dto.main_supplier_id ?? null,
        supplier_product_code: dto.supplier_product_code ?? null,
      });
    } catch (error) {
      throw this.translateSkuConflict(error);
    }

    await this.audit.log({
      userId,
      entity: 'products',
      entityId: product.id,
      action: 'PRODUCT_CREATED',
      newValue: { sku: product.sku, name: product.name },
    });

    return product;
  }

  search(query: string | undefined, includeInactive = false): Promise<products[]> {
    return this.repository.search({ query, includeInactive });
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
      barcode: dto.barcode,
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
      main_supplier_id: dto.main_supplier_id,
      supplier_product_code: dto.supplier_product_code,
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
