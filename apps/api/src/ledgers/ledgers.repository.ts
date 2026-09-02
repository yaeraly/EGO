import { Injectable } from '@nestjs/common';
import { Prisma, cargo_ledger, supplier_ledger } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenBalance {
  /** Outstanding amount in the ledger currency; positive means owed by us. */
  amount: Prisma.Decimal;
  /** The KGS value that amount was recognised at. */
  kgsValue: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class SupplierLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    tx: Prisma.TransactionClient,
    data: {
      supplierId: string;
      documentId: string;
      entryType: string;
      amountCny: Prisma.Decimal;
      kgsValue: Prisma.Decimal | null;
    },
  ): Promise<void> {
    await tx.supplier_ledger.create({
      data: {
        supplier_id: data.supplierId,
        document_id: data.documentId,
        entry_type: data.entryType,
        amount_cny: data.amountCny,
        kgs_value: data.kgsValue,
      },
    });
  }

  /**
   * The supplier's open debt and the KGS value it was recognised at.
   *
   * Both are returned as positive numbers when we owe money: the ledger stores
   * debt as negative, and negating once here keeps every caller from having to
   * remember the sign.
   */
  /** Whether one document already wrote an entry of this type. */
  async hasEntry(
    tx: Db,
    documentId: string,
    entryType: string,
  ): Promise<boolean> {
    const found = await tx.supplier_ledger.findFirst({
      where: { document_id: documentId, entry_type: entryType },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * The raw sum of one entry stream, in the ledger's own sign convention:
   * negative means we owe, positive means they do.
   */
  async streamBalance(
    tx: Db,
    supplierId: string,
    entryTypes: readonly string[],
  ): Promise<OpenBalance> {
    const [row] = await tx.$queryRaw<
      { amount: Prisma.Decimal | null; kgs: Prisma.Decimal | null }[]
    >`
      SELECT COALESCE(SUM(amount_cny), 0) AS amount,
             COALESCE(SUM(kgs_value), 0)  AS kgs
      FROM supplier_ledger
      WHERE supplier_id = ${supplierId}::uuid
        AND entry_type = ANY(${entryTypes as string[]})
    `;
    return { amount: row.amount ?? ZERO, kgsValue: row.kgs ?? ZERO };
  }

  /**
   * Open debt, as a positive number.
   *
   * The debt stream sums negative when we owe, and every caller here asks
   * "how much is owed", so the sign is flipped once, here, rather than at
   * each call site.
   */
  async openDebt(
    tx: Db,
    supplierId: string,
    entryTypes: readonly string[],
  ): Promise<OpenBalance> {
    const raw = await this.streamBalance(tx, supplierId, entryTypes);
    return { amount: raw.amount.negated(), kgsValue: raw.kgsValue.negated() };
  }

  async balance(db: Db, supplierId: string): Promise<Prisma.Decimal> {
    const [row] = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(amount_cny), 0) AS total
      FROM supplier_ledger WHERE supplier_id = ${supplierId}::uuid
    `;
    return row.total ?? ZERO;
  }

  history(supplierId: string, take = 200): Promise<supplier_ledger[]> {
    return this.prisma.supplier_ledger.findMany({
      where: { supplier_id: supplierId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  findByDocument(db: Db, documentId: string): Promise<supplier_ledger[]> {
    return db.supplier_ledger.findMany({ where: { document_id: documentId } });
  }

  /** Suppliers we currently owe, for the §39 digest. */
  async suppliersInDebt(): Promise<
    { supplier_id: string; name: string; amount_cny: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT l.supplier_id, s.name, SUM(l.amount_cny) AS amount_cny
      FROM supplier_ledger l
      JOIN suppliers s ON s.id = l.supplier_id
      GROUP BY l.supplier_id, s.name
      HAVING SUM(l.amount_cny) < 0
      ORDER BY SUM(l.amount_cny) ASC
    `;
  }
}

@Injectable()
export class CargoLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    tx: Prisma.TransactionClient,
    data: {
      cargoCompanyId: string;
      documentId: string;
      entryType: string;
      amountUsd: Prisma.Decimal;
      kgsValue: Prisma.Decimal | null;
    },
  ): Promise<void> {
    await tx.cargo_ledger.create({
      data: {
        cargo_company_id: data.cargoCompanyId,
        document_id: data.documentId,
        entry_type: data.entryType,
        amount_usd: data.amountUsd,
        kgs_value: data.kgsValue,
      },
    });
  }

  async openDebt(
    tx: Db,
    cargoCompanyId: string,
    entryTypes: readonly string[],
  ): Promise<OpenBalance> {
    const [row] = await tx.$queryRaw<
      { amount: Prisma.Decimal | null; kgs: Prisma.Decimal | null }[]
    >`
      SELECT COALESCE(SUM(amount_usd), 0) AS amount,
             COALESCE(SUM(kgs_value), 0)  AS kgs
      FROM cargo_ledger
      WHERE cargo_company_id = ${cargoCompanyId}::uuid
        AND entry_type = ANY(${entryTypes as string[]})
    `;
    return {
      amount: (row.amount ?? ZERO).negated(),
      kgsValue: (row.kgs ?? ZERO).negated(),
    };
  }

  async balance(db: Db, cargoCompanyId: string): Promise<Prisma.Decimal> {
    const [row] = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(amount_usd), 0) AS total
      FROM cargo_ledger WHERE cargo_company_id = ${cargoCompanyId}::uuid
    `;
    return row.total ?? ZERO;
  }

  history(cargoCompanyId: string, take = 200): Promise<cargo_ledger[]> {
    return this.prisma.cargo_ledger.findMany({
      where: { cargo_company_id: cargoCompanyId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  async companiesInDebt(): Promise<
    { cargo_company_id: string; name: string; amount_usd: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT l.cargo_company_id, c.name, SUM(l.amount_usd) AS amount_usd
      FROM cargo_ledger l
      JOIN cargo_companies c ON c.id = l.cargo_company_id
      GROUP BY l.cargo_company_id, c.name
      HAVING SUM(l.amount_usd) < 0
      ORDER BY SUM(l.amount_usd) ASC
    `;
  }
}
