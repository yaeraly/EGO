import { Injectable } from '@nestjs/common';
import { cargo_companies, suppliers } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: { name: string; contact: string | null }): Promise<suppliers> {
    return this.prisma.suppliers.create({ data });
  }

  findMany(includeInactive: boolean): Promise<suppliers[]> {
    return this.prisma.suppliers.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: { name: 'asc' },
    });
  }

  findById(id: string, db: Db = this.prisma): Promise<suppliers | null> {
    return db.suppliers.findUnique({ where: { id } });
  }

  update(
    id: string,
    data: { name?: string; contact?: string; is_active?: boolean },
  ): Promise<suppliers> {
    return this.prisma.suppliers.update({ where: { id }, data });
  }
}

@Injectable()
export class CargoCompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: { name: string }): Promise<cargo_companies> {
    return this.prisma.cargo_companies.create({ data });
  }

  findMany(includeInactive: boolean): Promise<cargo_companies[]> {
    return this.prisma.cargo_companies.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: { name: 'asc' },
    });
  }

  findById(id: string, db: Db = this.prisma): Promise<cargo_companies | null> {
    return db.cargo_companies.findUnique({ where: { id } });
  }

  update(
    id: string,
    data: { name?: string; is_active?: boolean },
  ): Promise<cargo_companies> {
    return this.prisma.cargo_companies.update({ where: { id }, data });
  }
}
