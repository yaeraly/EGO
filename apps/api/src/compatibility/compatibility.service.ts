import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  compatibility_status,
  user_role,
  vehicle_models,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateVehicleModelDto,
  LinkCompatibilityDto,
  UpdateVehicleModelDto,
} from './dto/compatibility.dto';

export interface CompatibilityLink {
  product_id: string;
  model_id: string;
  brand: string | null;
  model_name: string;
  status: compatibility_status;
  note: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
}

export interface ModelWithCount extends vehicle_models {
  /** How many parts are recorded as fitting it, and how many are checked. */
  products: number;
  verified: number;
}

/**
 * Structured compatibility (§12-Б.8, Приоритет 3).
 *
 * §12-Б.8 asks for three things in this phase: a many-to-many link between a
 * part and a vehicle model, a VERIFIED/UNVERIFIED status on it, and a filter
 * that finds the parts for a model.
 *
 * The status is the point of the whole thing. A salesperson knows what fits;
 * knowing and having checked are not the same, and a shop that sells the
 * wrong controller because someone was fairly sure loses the sale twice. So
 * anyone may record that a part fits — it is UNVERIFIED until the OWNER says
 * otherwise, and a verified link keeps who checked it and when.
 *
 * The MVP's free-text `compatibility_notes` stays exactly where it was
 * (§12-Б.8, §12-Б.9.6): a note somebody typed and a link somebody checked are
 * different things, and the search still reads both.
 */
@Injectable()
export class CompatibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── models ───────────────────────────────────────────────────────────────

  async createModel(
    dto: CreateVehicleModelDto,
    userId: string,
  ): Promise<vehicle_models> {
    const brand = dto.brand?.trim() || null;
    const name = dto.name.trim();

    const existing = await this.prisma.vehicle_models.findFirst({
      where: { brand, name },
    });
    if (existing) {
      throw new ConflictException(
        `${[brand, name].filter(Boolean).join(' ')} мурда киргизилген`,
      );
    }

    const model = await this.prisma.vehicle_models.create({
      data: { brand, name, notes: dto.notes?.trim() || null },
    });

    await this.audit.log({
      userId,
      entity: 'vehicle_models',
      entityId: model.id,
      action: 'VEHICLE_MODEL_CREATED',
      newValue: { brand, name },
    });

    return model;
  }

  async updateModel(
    id: string,
    dto: UpdateVehicleModelDto,
    userId: string,
  ): Promise<vehicle_models> {
    const current = await this.prisma.vehicle_models.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Модель табылган жок');
    }

    const brand = dto.brand === undefined ? current.brand : dto.brand.trim() || null;
    const name = dto.name === undefined ? current.name : dto.name.trim();

    if (brand !== current.brand || name !== current.name) {
      const clash = await this.prisma.vehicle_models.findFirst({
        where: { brand, name, NOT: { id } },
      });
      if (clash) {
        throw new ConflictException(
          `${[brand, name].filter(Boolean).join(' ')} мурда киргизилген`,
        );
      }
    }

    const model = await this.prisma.vehicle_models.update({
      where: { id },
      data: {
        brand,
        name,
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        updated_at: new Date(),
      },
    });

    await this.audit.log({
      userId,
      entity: 'vehicle_models',
      entityId: id,
      action: 'VEHICLE_MODEL_UPDATED',
      oldValue: {
        brand: current.brand,
        name: current.name,
        is_active: current.is_active,
      },
      newValue: { brand, name, is_active: model.is_active },
    });

    return model;
  }

  async models(includeInactive = false): Promise<ModelWithCount[]> {
    const rows = await this.prisma.$queryRaw<
      (vehicle_models & { products: bigint; verified: bigint })[]
    >`
      SELECT m.*,
             COUNT(c.product_id) AS products,
             COUNT(*) FILTER (WHERE c.cstatus = 'VERIFIED') AS verified
      FROM vehicle_models m
      LEFT JOIN product_compatibility c ON c.model_id = m.id
      ${includeInactive ? Prisma.empty : Prisma.sql`WHERE m.is_active`}
      GROUP BY m.id
      ORDER BY m.brand NULLS FIRST, m.name
    `;
    return rows.map((row) => ({
      ...row,
      products: Number(row.products),
      verified: Number(row.verified),
    }));
  }

  // ── links ────────────────────────────────────────────────────────────────

  /**
   * Records that a part fits a model.
   *
   * Anyone may say so, and it is UNVERIFIED until somebody checks: the person
   * at the counter is the one who finds out what actually fits, and making
   * them wait for the OWNER to write it down would lose the knowledge.
   */
  async link(
    productId: string,
    dto: LinkCompatibilityDto,
    userId: string,
  ): Promise<CompatibilityLink> {
    const [product, model] = await Promise.all([
      this.prisma.products.findUnique({ where: { id: productId } }),
      this.prisma.vehicle_models.findUnique({ where: { id: dto.model_id } }),
    ]);
    if (!product) {
      throw new NotFoundException('Товар табылган жок');
    }
    if (!model) {
      throw new NotFoundException('Модель табылган жок');
    }
    if (!model.is_active) {
      throw new BadRequestException('Архивделген моделге байланыш кошулбайт');
    }

    const existing = await this.prisma.product_compatibility.findUnique({
      where: { product_id_model_id: { product_id: productId, model_id: model.id } },
    });
    if (existing) {
      throw new ConflictException(
        `${product.name} мурда ${model.name} менен байланышкан`,
      );
    }

    await this.prisma.product_compatibility.create({
      data: {
        product_id: productId,
        model_id: model.id,
        note: dto.note?.trim() || null,
        created_by: userId,
      },
    });

    await this.audit.log({
      userId,
      entity: 'product_compatibility',
      entityId: `${productId}:${model.id}`,
      action: 'COMPATIBILITY_LINKED',
      newValue: {
        product: product.name,
        model: [model.brand, model.name].filter(Boolean).join(' '),
        status: compatibility_status.UNVERIFIED,
      },
      reason: dto.note?.trim() ?? null,
    });

    return this.one(productId, model.id);
  }

  /**
   * Marks a link checked, or takes the mark back (§12-Б.8).
   *
   * Only the OWNER: VERIFIED is the shop's word that the part really fits,
   * and a claim nobody stands behind is what UNVERIFIED already says.
   */
  async setVerified(
    productId: string,
    modelId: string,
    verified: boolean,
    user: { id: string; role: user_role },
  ): Promise<CompatibilityLink> {
    if (user.role !== user_role.OWNER) {
      throw new BadRequestException({
        message: 'Байланышты ээси гана текшерилди деп белгилейт (§12-Б.8)',
        code: 'OWNER_ONLY',
      });
    }

    const existing = await this.prisma.product_compatibility.findUnique({
      where: { product_id_model_id: { product_id: productId, model_id: modelId } },
    });
    if (!existing) {
      throw new NotFoundException('Байланыш табылган жок');
    }

    await this.prisma.product_compatibility.update({
      where: { product_id_model_id: { product_id: productId, model_id: modelId } },
      data: verified
        ? {
            cstatus: compatibility_status.VERIFIED,
            verified_by: user.id,
            verified_at: new Date(),
          }
        : {
            cstatus: compatibility_status.UNVERIFIED,
            verified_by: null,
            verified_at: null,
          },
    });

    await this.audit.log({
      userId: user.id,
      entity: 'product_compatibility',
      entityId: `${productId}:${modelId}`,
      action: verified ? 'COMPATIBILITY_VERIFIED' : 'COMPATIBILITY_UNVERIFIED',
      oldValue: { status: existing.cstatus },
      newValue: {
        status: verified
          ? compatibility_status.VERIFIED
          : compatibility_status.UNVERIFIED,
      },
    });

    return this.one(productId, modelId);
  }

  async unlink(
    productId: string,
    modelId: string,
    userId: string,
  ): Promise<void> {
    const existing = await this.prisma.product_compatibility.findUnique({
      where: { product_id_model_id: { product_id: productId, model_id: modelId } },
    });
    if (!existing) {
      throw new NotFoundException('Байланыш табылган жок');
    }

    await this.prisma.product_compatibility.delete({
      where: { product_id_model_id: { product_id: productId, model_id: modelId } },
    });

    await this.audit.log({
      userId,
      entity: 'product_compatibility',
      entityId: `${productId}:${modelId}`,
      action: 'COMPATIBILITY_UNLINKED',
      oldValue: { status: existing.cstatus, note: existing.note },
    });
  }

  /** Every model a part is recorded as fitting (§12-Б.4, §12-Б.8). */
  forProduct(productId: string): Promise<CompatibilityLink[]> {
    return this.links(Prisma.sql`c.product_id = ${productId}::uuid`);
  }

  private async one(
    productId: string,
    modelId: string,
  ): Promise<CompatibilityLink> {
    const [row] = await this.links(
      Prisma.sql`c.product_id = ${productId}::uuid AND c.model_id = ${modelId}::uuid`,
    );
    return row;
  }

  private links(where: Prisma.Sql): Promise<CompatibilityLink[]> {
    return this.prisma.$queryRaw<CompatibilityLink[]>`
      SELECT c.product_id, c.model_id,
             m.brand, m.name AS model_name,
             c.cstatus AS status, c.note,
             c.verified_by, u.full_name AS verified_by_name,
             c.verified_at
      FROM product_compatibility c
      JOIN vehicle_models m ON m.id = c.model_id
      LEFT JOIN users u ON u.id = c.verified_by
      WHERE ${where}
      ORDER BY m.brand NULLS FIRST, m.name
    `;
  }
}
