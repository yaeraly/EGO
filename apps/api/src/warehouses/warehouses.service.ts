import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { warehouse_type, warehouses } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { WarehousesRepository } from './warehouses.repository';

/**
 * Warehouse — a master-data object in its own right (§12-А).
 *
 * Stock is never a single company-wide number: it lives at Product +
 * Warehouse + LOT (§12-А.2), and every movement names a warehouse. MAIN and
 * DEFECT are the two the system cannot work without — MAIN is what is for
 * sale, DEFECT is deliberately outside Available Stock (§12-А.6).
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateWarehouseDto, userId: string): Promise<warehouses> {
    const code = dto.code.trim().toUpperCase();
    if (await this.repository.findByCode(code)) {
      throw new ConflictException(`Warehouse code ${code} is already taken (§12-А.1)`);
    }

    const warehouse = await this.repository.insert({
      code,
      name: dto.name.trim(),
      wtype: dto.wtype,
      address: dto.address ?? null,
      comment: dto.comment ?? null,
      ...(dto.responsible_user
        ? { users: { connect: { id: dto.responsible_user } } }
        : {}),
    });

    await this.audit.log({
      userId,
      entity: 'warehouses',
      entityId: warehouse.id,
      action: 'WAREHOUSE_CREATED',
      newValue: { code: warehouse.code, name: warehouse.name, wtype: warehouse.wtype },
    });

    return warehouse;
  }

  findAll(includeInactive = false): Promise<warehouses[]> {
    return this.repository.findAll(includeInactive);
  }

  async findOne(id: string, db?: Db): Promise<warehouses> {
    const warehouse = await this.repository.findById(id, db);
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    return warehouse;
  }

  /**
   * The warehouse a movement is allowed to touch (§12-А.8.7).
   *
   * An inactive warehouse still shows its history and its remaining stock;
   * what it refuses is *new* movement, which is what this checks.
   */
  async requireActive(id: string, db?: Db): Promise<warehouses> {
    const warehouse = await this.findOne(id, db);
    if (!warehouse.is_active) {
      throw new ConflictException(
        `Warehouse ${warehouse.code} is inactive and takes no new movements (§12-А.8.7)`,
      );
    }
    return warehouse;
  }

  /** The default destination for a receipt: the main saleable warehouse. */
  async main(): Promise<warehouses> {
    return this.requireOfType(warehouse_type.MAIN);
  }

  /** Where damaged goods go on arrival (§8.4, §12-А.6). */
  async defect(): Promise<warehouses> {
    return this.requireOfType(warehouse_type.DEFECT);
  }

  private async requireOfType(wtype: warehouse_type): Promise<warehouses> {
    const warehouse = await this.repository.findFirstOfType(wtype);
    if (!warehouse) {
      throw new ConflictException(
        `No active ${wtype} warehouse exists; the system needs one (§12-А)`,
      );
    }
    return warehouse;
  }

  async update(
    id: string,
    dto: UpdateWarehouseDto,
    userId: string,
  ): Promise<warehouses> {
    const before = await this.findOne(id);

    // Deactivating a warehouse that still holds goods would strand them:
    // nothing could move them out, because movement needs an active
    // warehouse. Empty it with a transfer first (§12-А.4).
    if (dto.is_active === false && (await this.repository.holdsStock(id))) {
      throw new ConflictException(
        `${before.code} still holds stock; transfer it out (TRF) before deactivating (§12-А.4)`,
      );
    }
    if (dto.is_active === false && before.wtype === warehouse_type.MAIN) {
      throw new BadRequestException(
        'The MAIN warehouse cannot be deactivated: receipts have nowhere to land (§12-А)',
      );
    }

    const warehouse = await this.repository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      ...(dto.responsible_user !== undefined
        ? dto.responsible_user === null
          ? { users: { disconnect: true } }
          : { users: { connect: { id: dto.responsible_user } } }
        : {}),
    });

    await this.audit.log({
      userId,
      entity: 'warehouses',
      entityId: id,
      action: 'WAREHOUSE_UPDATED',
      oldValue: {
        name: before.name,
        address: before.address,
        is_active: before.is_active,
      },
      newValue: {
        name: warehouse.name,
        address: warehouse.address,
        is_active: warehouse.is_active,
      },
    });

    return warehouse;
  }
}
