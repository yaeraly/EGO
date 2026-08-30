import { Injectable, NotFoundException } from '@nestjs/common';
import { cargo_companies, suppliers } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import {
  CargoCompaniesRepository,
  SuppliersRepository,
} from './counterparties.repository';
import {
  CreateCargoCompanyDto,
  CreateSupplierDto,
  UpdateCargoCompanyDto,
  UpdateSupplierDto,
} from './dto/counterparty.dto';

/**
 * Suppliers (§4) and cargo companies (§5.2).
 *
 * Both are deactivated rather than deleted: their ledgers, purchases and
 * payments stay attributable, the same rule staff and investors follow.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly repository: SuppliersRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSupplierDto, userId: string): Promise<suppliers> {
    const supplier = await this.repository.insert({
      name: dto.name,
      contact: dto.contact ?? null,
    });

    await this.audit.log({
      userId,
      entity: 'suppliers',
      entityId: supplier.id,
      action: 'SUPPLIER_CREATED',
      newValue: { name: supplier.name, contact: supplier.contact },
    });

    return supplier;
  }

  findAll(includeInactive = false): Promise<suppliers[]> {
    return this.repository.findMany(includeInactive);
  }

  async findOne(id: string, db?: Db): Promise<suppliers> {
    const supplier = await this.repository.findById(id, db);
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    userId: string,
  ): Promise<suppliers> {
    const before = await this.findOne(id);

    const supplier = await this.repository.update(id, {
      name: dto.name,
      contact: dto.contact,
      is_active: dto.is_active,
    });

    await this.audit.log({
      userId,
      entity: 'suppliers',
      entityId: id,
      action: 'SUPPLIER_UPDATED',
      oldValue: { name: before.name, contact: before.contact, is_active: before.is_active },
      newValue: {
        name: supplier.name,
        contact: supplier.contact,
        is_active: supplier.is_active,
      },
    });

    return supplier;
  }
}

@Injectable()
export class CargoCompaniesService {
  constructor(
    private readonly repository: CargoCompaniesRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateCargoCompanyDto,
    userId: string,
  ): Promise<cargo_companies> {
    const company = await this.repository.insert({ name: dto.name });

    await this.audit.log({
      userId,
      entity: 'cargo_companies',
      entityId: company.id,
      action: 'CARGO_COMPANY_CREATED',
      newValue: { name: company.name },
    });

    return company;
  }

  findAll(includeInactive = false): Promise<cargo_companies[]> {
    return this.repository.findMany(includeInactive);
  }

  async findOne(id: string, db?: Db): Promise<cargo_companies> {
    const company = await this.repository.findById(id, db);
    if (!company) {
      throw new NotFoundException('Cargo company not found');
    }
    return company;
  }

  async update(
    id: string,
    dto: UpdateCargoCompanyDto,
    userId: string,
  ): Promise<cargo_companies> {
    const before = await this.findOne(id);

    const company = await this.repository.update(id, {
      name: dto.name,
      is_active: dto.is_active,
    });

    await this.audit.log({
      userId,
      entity: 'cargo_companies',
      entityId: id,
      action: 'CARGO_COMPANY_UPDATED',
      oldValue: { name: before.name, is_active: before.is_active },
      newValue: { name: company.name, is_active: company.is_active },
    });

    return company;
  }
}
