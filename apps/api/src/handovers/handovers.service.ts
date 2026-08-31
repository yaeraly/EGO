import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, doc_type, documents } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { UsersService } from '../users/users.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  CreateHandoverDto,
  HandoverCountDto,
  SignHandoverDto,
} from './dto/handover.dto';
import { chooseSample } from './handover-sample';
import { HandoverFull, HandoversRepository } from './handovers.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * Warehouse handover (HND) — §21.
 *
 * Three salespeople take turns answering for the stock, and the act is how
 * that answer changes hands. Two things make it real: the system picks what
 * is counted (§21.1), and responsibility does not move until both people have
 * signed — "Жоопкерчилик акт эки тарап тарабынан ырасталмайынча кийинки
 * сатуучуга өтпөйт".
 *
 * A handover records a difference; it does not correct one. §22 does that,
 * through an Inventory Adjustment the OWNER confirms.
 */
@Injectable()
export class HandoversService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.HND;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: HandoversRepository,
    private readonly warehouses: WarehousesService,
    private readonly stock: StockService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateHandoverDto, userId: string): Promise<documents> {
    if (dto.to_user === userId) {
      throw new BadRequestException(
        'Жоопкерчилик өзүнө өткөрүлбөйт — кабыл алуучу башка кызматкер болушу керек (§21)',
      );
    }
    const receiver = await this.users.findOne(dto.to_user);
    if (receiver.status !== 'ACTIVE') {
      throw new BadRequestException('Кабыл алуучу кызматкер активдүү эмес');
    }

    const warehouse = await this.warehouses.findOne(dto.warehouse_id);
    const held = await this.stock.stockByProduct({ warehouseId: warehouse.id });
    if (held.length === 0) {
      throw new BadRequestException(
        `${warehouse.code} складында текшере турган товар жок`,
      );
    }

    const products = await this.prisma.products.findMany({
      where: { id: { in: held.map((entry) => entry.product_id) } },
      select: { id: true, category_id: true },
    });
    const categoryOf = new Map(
      products.map((product) => [product.id, product.category_id]),
    );

    const sample = chooseSample({
      held: held.map((entry) => ({
        productId: entry.product_id,
        categoryId: categoryOf.get(entry.product_id) ?? null,
      })),
      aClassCategories: await this.aClassCategories(),
      randomPositions: await this.randomPositions(),
    });

    const qtyOf = new Map(
      held.map((entry) => [
        entry.product_id,
        new Prisma.Decimal(
          entry.by_warehouse.find((row) => row.warehouse_id === warehouse.id)
            ?.qty ?? '0',
        ),
      ]),
    );
    const valueOf = new Map(
      held.map((entry) => [
        entry.product_id,
        new Prisma.Decimal(
          entry.by_warehouse.find((row) => row.warehouse_id === warehouse.id)
            ?.value_kgs ?? '0',
        ),
      ]),
    );

    const totalValue = sample.reduce(
      (sum, item) => sum.plus(valueOf.get(item.productId) ?? ZERO),
      ZERO,
    );

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.HND,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        fromUser: userId,
        toUser: dto.to_user,
        totalValue,
      });

      await this.repository.insertItems(
        tx,
        document.id,
        sample.map((item) => ({
          productId: item.productId,
          isAClass: item.isAClass,
          systemQty: qtyOf.get(item.productId) ?? ZERO,
        })),
      );

      return document;
    });
  }

  /** Both people count together (§21.1); either may record the figures. */
  async count(
    id: string,
    dto: HandoverCountDto,
    userId: string,
  ): Promise<HandoverFull> {
    return this.prisma.$transaction(async (tx) => {
      const handover = await this.requireOpen(tx, id);
      this.assertParty(handover, userId);

      if (handover.from_confirmed_at || handover.to_confirmed_at) {
        throw new ConflictException(
          'Кол коюлгандан кийин сандар өзгөртүлбөйт — жаңы акт түзүңүз (§21.1)',
        );
      }

      for (const line of dto.items) {
        const item = handover.handover_checked_items.find(
          (row) => row.id === line.item_id,
        );
        if (!item) {
          throw new NotFoundException(`Сап табылган жок: ${line.item_id}`);
        }
        const actual = toDecimal(line.actual_qty, 'actual_qty');
        if (actual.isNegative()) {
          throw new BadRequestException('Фактический калдык терс болбойт');
        }
        await this.repository.updateItem(tx, item.id, actual);
      }

      return this.requireHandover(tx, id);
    });
  }

  /**
   * One side signs (§21.1).
   *
   * The second signature is what confirms the document, and therefore what
   * moves the responsibility. Until then the act is a draft that binds nobody.
   */
  async sign(
    id: string,
    dto: SignHandoverDto,
    userId: string,
  ): Promise<HandoverFull> {
    const signed = await this.prisma.$transaction(async (tx) => {
      const handover = await this.requireOpen(tx, id);
      const side = this.assertParty(handover, userId);

      if (side === 'from' && handover.from_confirmed_at) {
        throw new ConflictException('Өткөрүп жаткан тарап мурда кол койгон');
      }
      if (side === 'to' && handover.to_confirmed_at) {
        throw new ConflictException('Кабыл алган тарап мурда кол койгон');
      }

      await this.repository.sign(tx, id, side, new Date());

      await this.audit.log(
        {
          userId,
          documentId: id,
          entity: 'handover_acts',
          entityId: id,
          action: side === 'from' ? 'HANDOVER_SIGNED_BY_SENDER' : 'HANDOVER_SIGNED_BY_RECEIVER',
          newValue: { comment: dto.comment ?? null },
        },
        tx,
      );

      return this.requireHandover(tx, id);
    });

    const bothSigned = signed.from_confirmed_at && signed.to_confirmed_at;
    if (!bothSigned) {
      return signed;
    }

    await this.documents.confirm(id, userId);
    return this.requireHandover(this.prisma, id);
  }

  /**
   * Posting an act records the difference it found (§21.1).
   *
   * Stock is not touched: a handover is a check. Where it disagrees with the
   * system, §22's Inventory Adjustment is what corrects the books, and only
   * the OWNER may confirm one.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const handover = await this.requireHandover(tx, document.id);

    if (!handover.from_confirmed_at || !handover.to_confirmed_at) {
      throw new ConflictException(
        'Акт эки тарап тең кол койгондо гана күчүнө кирет (§21.1)',
      );
    }

    let difference = ZERO;
    const findings: Prisma.InputJsonValue[] = [];

    for (const item of handover.handover_checked_items) {
      const diff = item.actual_qty.minus(item.system_qty);
      if (diff.isZero()) {
        continue;
      }
      difference = difference.plus(diff);
      findings.push({
        product_id: item.product_id,
        is_a_class: item.is_a_class,
        system_qty: item.system_qty.toFixed(2),
        actual_qty: item.actual_qty.toFixed(2),
        diff_qty: diff.toFixed(2),
      });
    }

    await this.repository.setDifference(tx, document.id, difference);

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'handover_acts',
        entityId: document.id,
        action: 'HANDOVER_COMPLETED',
        newValue: {
          from_user: handover.from_user,
          to_user: handover.to_user,
          checked_positions: handover.handover_checked_items.length,
          a_class_positions: handover.handover_checked_items.filter(
            (item) => item.is_a_class,
          ).length,
          total_value_kgs: handover.total_value?.toFixed(2) ?? null,
          difference_qty: difference.toFixed(2),
          // §22 owns the correction; this act only reports what it saw.
          findings,
        },
      },
      tx,
    );
  }

  findMany(filter: { userId?: string }): Promise<HandoverFull[]> {
    return this.repository.findMany(filter);
  }

  findOne(id: string, db: Db = this.prisma): Promise<HandoverFull> {
    return this.requireHandover(db, id);
  }

  private async aClassCategories(): Promise<string[]> {
    const setting = await this.settings
      .findOne(SettingKey.HANDOVER_A_CLASS_CATEGORIES)
      .catch(() => null);
    if (!setting || !Array.isArray(setting.value)) {
      return [];
    }
    return setting.value.filter(
      (value): value is string => typeof value === 'string',
    );
  }

  private async randomPositions(): Promise<number> {
    const value = await this.settings.optionalDecimal(
      SettingKey.HANDOVER_RANDOM_POSITIONS,
    );
    return value === null ? 12 : value.toNumber();
  }

  private assertParty(handover: HandoverFull, userId: string): 'from' | 'to' {
    if (handover.from_user === userId) return 'from';
    if (handover.to_user === userId) return 'to';
    throw new ConflictException(
      'Бул актка ага катышкан эки кызматкер гана кол коёт (§21.1)',
    );
  }

  private async requireHandover(db: Db, id: string): Promise<HandoverFull> {
    const handover = await this.repository.findById(db, id);
    if (!handover) {
      throw new NotFoundException('Өткөрүп-кабыл алуу актысы табылган жок');
    }
    return handover;
  }

  private async requireOpen(db: Db, id: string): Promise<HandoverFull> {
    const handover = await this.requireHandover(db, id);
    if (handover.documents.status !== 'DRAFT') {
      throw new ConflictException('Бул акт мурда жабылган (§27.1)');
    }
    return handover;
  }
}
