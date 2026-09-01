import { Injectable, OnModuleInit } from '@nestjs/common';
import { doc_status, doc_type } from '@prisma/client';
import {
  DayCloseBlocker,
  DayCloseBlockerRegistry,
  DayCloseBlockerSource,
} from '../business-days/day-close-blockers';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What a draft of each kind is called, in the words the person closing the
 * day would use. Period Lock names them one by one: DRAFT Sale, DRAFT/
 * Incomplete Payment, DRAFT Receipt, DRAFT Return, DRAFT Expense, DRAFT
 * Write-off, DRAFT Inventory document, DRAFT Warehouse Transfer, "башка
 * unresolved/open документтер".
 */
const WHAT_IT_IS: Partial<Record<doc_type, string>> = {
  [doc_type.SAL]: 'Сатуу',
  [doc_type.LSS]: 'Зыяндуу сатуу',
  [doc_type.PAY]: 'Кардардын төлөмү',
  [doc_type.RCV]: 'Приход',
  [doc_type.RET]: 'Возврат',
  [doc_type.EXP]: 'Чыгым',
  [doc_type.WOF]: 'Списание',
  [doc_type.INV]: 'Инвентаризация',
  [doc_type.TRF]: 'Складдар аралык которуу',
  [doc_type.TRN]: 'Эсептер аралык которуу',
  [doc_type.SPY]: 'Поставщикке төлөм',
  [doc_type.CPY]: 'Каргого төлөм',
  [doc_type.RSV]: 'Бронь',
  [doc_type.ADV]: 'Аванс',
  [doc_type.DEF]: 'Брак актысы',
  [doc_type.CEX]: 'Валюта алмаштыруу',
  [doc_type.SLR]: 'Айлык',
  [doc_type.BON]: 'Бонус',
  [doc_type.COR]: 'Коррекция',
  [doc_type.CAP]: 'Капитал салуу',
  [doc_type.WDW]: 'Ээсинин акча алуусу',
  [doc_type.OIN]: 'Башка киреше',
  [doc_type.PUR]: 'Сатып алуу заказы',
  [doc_type.LOT]: 'Партия (LOT)',
  [doc_type.DIF]: 'Расхождение',
  [doc_type.CLM]: 'Талап',
  [doc_type.HND]: 'Жоопкерчилик актысы',
};

/**
 * Every unfinished draft, as of a business date (Period Lock — Day Close
 * Pre-check).
 *
 * One source rather than one per module: a draft is unfinished in exactly the
 * same way whatever it is, and the pre-check's job is to name it. Work that is
 * unfinished in a way of its own — a transfer sent and not received — stays
 * with the module that knows what that means.
 *
 * Drafts *before* the date count too. A day cannot be sealed while an older
 * one is still hanging, or the older day could never be closed either.
 */
@Injectable()
export class DraftDocumentsBlocker
  implements DayCloseBlockerSource, OnModuleInit
{
  readonly blockerKind = 'DOCUMENT_DRAFT';

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: DayCloseBlockerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async blockers(businessDate: Date): Promise<DayCloseBlocker[]> {
    const drafts = await this.prisma.documents.findMany({
      where: { status: doc_status.DRAFT, business_date: { lte: businessDate } },
      orderBy: [{ business_date: 'asc' }, { doc_number: 'asc' }],
    });

    return drafts.map((document) => ({
      kind: this.blockerKind,
      document_id: document.id,
      doc_number: document.doc_number,
      detail: `${WHAT_IT_IS[document.doc_type] ?? document.doc_type} черновик бойдон — тастыкталсын же жокко чыгарылсын`,
    }));
  }
}
