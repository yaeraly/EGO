import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  doc_type,
  documents,
  stock_movement_type,
  warehouse_type,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  ConfirmWriteOffDto,
  CreateOtherIncomeDto,
  CreateWriteOffDto,
} from './dto/write-off.dto';

const ZERO = new Prisma.Decimal(0);

export type WriteOffFull = Prisma.write_offsGetPayload<{
  include: { write_off_items: true; documents: true };
}>;

/**
 * Write-off (WOF) and other income (OIN) — §38.
 *
 * Defective goods are not sent back to China; they pile up in DEFECT and are
 * eventually scrapped. §38 is that ending, in order: settle any open supplier
 * claim first, write the goods off at their own landed cost, then book what
 * the copper and aluminium fetched as its own income against the same act.
 *
 * The point of keeping the two documents linked is the figure §38 asks for:
 *
 *   net defect loss = written-off cost − scrap income − supplier compensation
 *
 * and none of it belongs to anyone's bonus base.
 */
@Injectable()
export class WriteOffsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.WOF;
  /** OIN posts here too: one small module, two documents §38 pairs. */
  readonly alsoPosts = [doc_type.OIN] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly accounts: AccountsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateWriteOffDto, userId: string): Promise<documents> {
    const warehouse = await this.warehouses.findOne(dto.warehouse_id);
    if (warehouse.wtype !== warehouse_type.DEFECT) {
      throw new BadRequestException(
        `${warehouse.code} — DEFECT склады эмес; списание брак кампасынан жүргүзүлөт (§38.4)`,
      );
    }

    const lines: {
      layerId: string;
      qty: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      productId: string;
    }[] = [];
    let total = ZERO;

    for (const [index, item] of dto.items.entries()) {
      const qty = toDecimal(item.qty, `items[${index}].qty`);
      if (qty.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException(`items[${index}].qty оң болушу керек`);
      }

      const layer = await this.prisma.fifo_layers.findUnique({
        where: { id: item.layer_id },
        select: { id: true, unit_cost: true, product_id: true },
      });
      if (!layer) {
        throw new NotFoundException(`LOT табылган жок: ${item.layer_id}`);
      }

      const onHand = await this.stock.onHand(
        this.prisma,
        layer.id,
        warehouse.id,
      );
      if (qty.greaterThan(onHand)) {
        throw new ConflictException(
          `Бул LOT'то ${warehouse.code} складында ${onHand.toFixed(2)} гана бар (§42.5)`,
        );
      }

      lines.push({
        layerId: layer.id,
        qty,
        unitCost: layer.unit_cost,
        productId: layer.product_id,
      });
      total = total.plus(
        qty.times(layer.unit_cost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      );
    }

    // §38.2 — an open claim over the same goods is decided first, not written
    // off around. Compensation may still arrive, and §8.7 would have nowhere
    // to land it once the stock is gone.
    const blocking = await this.openClaimsFor(
      lines.map((line) => line.productId),
    );
    if (blocking.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'Бул товарлар боюнча ачык Supplier Claim бар — адегенде анын тагдырын чечиңиз (§38.2)',
        code: 'OPEN_CLAIM',
        claims: blocking,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.WOF,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.reason.trim(),
      });

      await tx.write_offs.create({
        data: { document_id: document.id, total_cost: total },
      });
      await tx.write_off_items.createMany({
        data: lines.map((line) => ({
          write_off_id: document.id,
          layer_id: line.layerId,
          warehouse_id: warehouse.id,
          qty: line.qty,
          unit_cost: line.unitCost,
        })),
      });

      return document;
    });
  }

  /** §38.3–4 — the act, confirmed with a PIN, takes the goods off the books. */
  async confirm(
    id: string,
    dto: ConfirmWriteOffDto,
    userId: string,
    ip?: string,
  ): Promise<WriteOffFull> {
    const { valid } = await this.auth.verifyPin(userId, dto.pin, {
      ip: ip ?? null,
      device: `write-off:${id}`,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }

    await this.documents.confirm(id, userId);
    return this.findOne(id);
  }

  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    if (document.doc_type === doc_type.OIN) {
      return this.postOtherIncome(tx, document, userId);
    }

    const record = await this.requireWriteOff(tx, document.id);
    let total = ZERO;
    const scrapped: Prisma.InputJsonValue[] = [];

    for (const item of record.write_off_items) {
      await this.stock.removeFromWarehouse(tx, {
        layerId: item.layer_id,
        warehouseId: item.warehouse_id,
        qty: item.qty,
        documentId: document.id,
        movementType: stock_movement_type.WRITEOFF_OUT,
      });

      const value = item.qty
        .times(item.unit_cost)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      total = total.plus(value);
      scrapped.push({
        layer_id: item.layer_id,
        qty: item.qty.toFixed(2),
        unit_cost: item.unit_cost.toFixed(4),
        value_kgs: value.toFixed(2),
      });
    }

    await tx.write_offs.update({
      where: { document_id: document.id },
      data: { total_cost: total },
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'write_offs',
        entityId: document.id,
        action: 'WRITE_OFF_CONFIRMED',
        newValue: {
          total_cost_kgs: total.toFixed(2),
          // §38: defect losses stay out of the sellers' bonus base.
          in_bonus_base: false,
          items: scrapped,
        },
        reason: document.comment,
      },
      tx,
    );
  }

  /** §38.7 — what the scrap fetched, as its own document. */
  async createOtherIncome(
    dto: CreateOtherIncomeDto,
    userId: string,
  ): Promise<documents> {
    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('Сумма оң болушу керек');
    }

    const account = await this.accounts.findOne(dto.account_id);
    if (!account.is_active) {
      throw new BadRequestException(`${account.name} эсеби активдүү эмес`);
    }
    if (account.currency !== 'KGS') {
      throw new BadRequestException(
        `${account.name} — ${account.currency} эсеби; металлдан түшкөн киреше сом менен катталат`,
      );
    }

    if (dto.linked_write_off) {
      const linked = await this.prisma.write_offs.findUnique({
        where: { document_id: dto.linked_write_off },
        select: { document_id: true },
      });
      if (!linked) {
        throw new NotFoundException('Списание актысы табылган жок');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.OIN,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.source.trim(),
      });

      await tx.other_income.create({
        data: {
          document_id: document.id,
          category: dto.category,
          account_id: dto.account_id,
          amount,
          linked_write_off: dto.linked_write_off ?? null,
        },
      });

      return document;
    });
  }

  private async postOtherIncome(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const income = await tx.other_income.findUnique({
      where: { document_id: document.id },
    });
    if (!income) {
      throw new NotFoundException(
        `Other income body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      income.account_id,
    );
    await this.accounts.postMovement(tx, {
      accountId: income.account_id,
      documentId: document.id,
      amount: income.amount,
      kgsValue: null,
      currentBalance: balance,
      accountName: account.name,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'other_income',
        entityId: document.id,
        action: 'OTHER_INCOME_RECEIVED',
        newValue: {
          category: income.category,
          amount: income.amount.toFixed(2),
          account_id: income.account_id,
          linked_write_off: income.linked_write_off,
          in_bonus_base: false,
        },
        reason: document.comment,
      },
      tx,
    );
  }

  /**
   * §38's figure: what the defect actually cost the business.
   *
   *   net loss = written-off cost − scrap income − supplier compensation
   */
  async defectResult(writeOffId: string): Promise<{
    written_off_cost: string;
    scrap_income: string;
    net_loss: string;
  }> {
    const record = await this.requireWriteOff(this.prisma, writeOffId);
    const income = await this.prisma.other_income.findMany({
      where: {
        linked_write_off: writeOffId,
        documents: { status: 'CONFIRMED' },
      },
      select: { amount: true },
    });

    const scrap = income.reduce((sum, row) => sum.plus(row.amount), ZERO);
    return {
      written_off_cost: record.total_cost.toFixed(2),
      scrap_income: scrap.toFixed(2),
      net_loss: record.total_cost.minus(scrap).toFixed(2),
    };
  }

  findMany(): Promise<WriteOffFull[]> {
    return this.prisma.write_offs.findMany({
      include: { write_off_items: true, documents: true },
      orderBy: { documents: { created_at: 'desc' } },
      take: 100,
    });
  }

  findOne(id: string, db: Db = this.prisma): Promise<WriteOffFull> {
    return this.requireWriteOff(db, id);
  }

  /**
   * Claims still open over the same products (§38.2).
   *
   * A claim reaches a product through the discrepancy it was raised for, which
   * is the link the schema provides.
   */
  private async openClaimsFor(
    productIds: string[],
  ): Promise<{ document_id: string; doc_number: string; amount: string }[]> {
    const rows = await this.prisma.claims.findMany({
      where: {
        cstatus: 'OPEN',
        discrepancies: { product_id: { in: productIds } },
      },
      include: {
        documents: { select: { doc_number: true } },
      },
    });
    return rows.map((row) => ({
      document_id: row.document_id,
      doc_number: row.documents.doc_number,
      amount: row.amount.toFixed(2),
    }));
  }

  private async requireWriteOff(db: Db, id: string): Promise<WriteOffFull> {
    const record = await db.write_offs.findUnique({
      where: { document_id: id },
      include: { write_off_items: true, documents: true },
    });
    if (!record) {
      throw new NotFoundException('Списание актысы табылган жок');
    }
    return record;
  }
}
