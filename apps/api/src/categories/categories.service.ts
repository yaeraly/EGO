import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { product_categories } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { CategoriesRepository } from './categories.repository';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

export interface CategoryView extends product_categories {
  /** How many products are filed under it — what makes it deletable or not. */
  product_count: number;
}

/**
 * Product categories (§12-Б.1).
 *
 * A category carries one rule of its own: the warranty a product inherits
 * when it sets none (§12-Б.7, §36-А.1). That is why deleting one is not
 * simply a row removal — the products under it would silently lose the
 * warranty term their returns are judged by (§36-А.2).
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly repository: CategoriesRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCategoryDto, userId: string): Promise<product_categories> {
    const name = dto.name.trim();
    if (await this.repository.findByName(name)) {
      throw new ConflictException(`«${name}» категориясы мурдатан бар (§12-Б.1)`);
    }

    const code = dto.code?.trim().toUpperCase() || null;
    if (code && (await this.repository.findByCode(code))) {
      throw new ConflictException(`«${code}» коду башка категорияда колдонулуп жатат`);
    }

    const category = await this.repository.insert({
      name,
      code,
      default_warranty_days: dto.default_warranty_days ?? 0,
    });

    await this.audit.log({
      userId,
      entity: 'product_categories',
      entityId: category.id,
      action: 'CATEGORY_CREATED',
      newValue: {
        name: category.name,
        code: category.code,
        default_warranty_days: category.default_warranty_days,
      },
    });

    return category;
  }

  async findAll(): Promise<CategoryView[]> {
    const [categories, counts] = await Promise.all([
      this.repository.findAll(),
      this.repository.productCounts(),
    ]);
    return categories.map((category) => ({
      ...category,
      product_count: counts.get(category.id) ?? 0,
    }));
  }

  async findOne(id: string, db?: Db): Promise<product_categories> {
    const category = await this.repository.findById(id, db);
    if (!category) {
      throw new NotFoundException('Категория табылган жок');
    }
    return category;
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    userId: string,
  ): Promise<product_categories> {
    const before = await this.findOne(id);

    const name = dto.name?.trim();
    if (name && name !== before.name) {
      const clash = await this.repository.findByName(name);
      if (clash) {
        throw new ConflictException(`«${name}» категориясы мурдатан бар (§12-Б.1)`);
      }
    }

    const code =
      dto.code === undefined ? undefined : dto.code.trim().toUpperCase() || null;
    if (code && code !== before.code) {
      const clash = await this.repository.findByCode(code);
      if (clash) {
        throw new ConflictException(
          `«${code}» коду башка категорияда колдонулуп жатат`,
        );
      }
    }

    // Changing a code does not renumber the SKUs already issued: a code is
    // the state at the moment it was given (§12-Б.9.1).
    const category = await this.repository.update(id, {
      ...(name ? { name } : {}),
      ...(code === undefined ? {} : { code }),
      ...(dto.default_warranty_days === undefined
        ? {}
        : { default_warranty_days: dto.default_warranty_days }),
    });

    await this.audit.log({
      userId,
      entity: 'product_categories',
      entityId: id,
      action: 'CATEGORY_UPDATED',
      oldValue: {
        name: before.name,
        default_warranty_days: before.default_warranty_days,
      },
      newValue: {
        name: category.name,
        code: category.code,
        default_warranty_days: category.default_warranty_days,
      },
    });

    return category;
  }

  async remove(id: string, userId: string): Promise<void> {
    const category = await this.findOne(id);

    // A category in use is not deletable: §12-Б.7 makes its warranty term the
    // fallback for every product under it, and §36-А.2 judges warranty returns
    // by that term. Removing it would change how those returns are decided.
    const products = await this.repository.countProducts(id);
    if (products > 0) {
      throw new ConflictException(
        `«${category.name}» категориясында ${products} товар бар — адегенде аларды башка категорияга которуңуз (§12-Б.7)`,
      );
    }

    await this.repository.delete(id);

    await this.audit.log({
      userId,
      entity: 'product_categories',
      entityId: id,
      action: 'CATEGORY_DELETED',
      oldValue: {
        name: category.name,
        default_warranty_days: category.default_warranty_days,
      },
    });
  }

  /**
   * Warranty days in force for a product (§12-Б.7).
   *
   * The product's own value wins when it has one; 0 there is a deliberate "no
   * warranty", not an absence, so only NULL falls through to the category.
   */
  async warrantyDays(
    productWarrantyDays: number | null,
    categoryId: string | null,
    db?: Db,
  ): Promise<number> {
    if (productWarrantyDays !== null) {
      return productWarrantyDays;
    }
    if (!categoryId) {
      return 0;
    }
    const category = await this.repository.findById(categoryId, db);
    return category?.default_warranty_days ?? 0;
  }
}
