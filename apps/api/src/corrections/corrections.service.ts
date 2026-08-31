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
  corrections,
  doc_status,
  doc_type,
  documents,
  user_role,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { parseBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { MONEY_ONLY, correctableType } from './correction-rules';
import { ConfirmCorrectionDto, CreateCorrectionDto } from './dto/correction.dto';

/**
 * What the OWNER decided, carried from the request into the posting.
 *
 * The poster runs inside the confirming transaction, long after the request
 * object is gone, and Period Lock requires the OWNER and their PIN on every
 * correction. Confirming a COR through the generic document endpoint leaves
 * this empty, and the poster refuses — which is the point.
 */
@Injectable()
export class CorrectionConfirmContext {
  private current: { userId: string } | null = null;

  set(value: { userId: string }): void {
    this.current = value;
  }

  take(): { userId: string } | null {
    const value = this.current;
    this.current = null;
    return value;
  }
}

export interface CorrectionFull extends corrections {
  document: documents;
  original: documents;
}

/**
 * Correction / Reversal (COR) — §27.1, Period Lock.
 *
 * A confirmed document is a posted fact. When it turns out to be wrong it is
 * not edited and not deleted: a correction document is raised against it,
 * carrying the original's number and date, the reason, the old and the new
 * value, and its own money movements — the exact inverse of what the original
 * posted. The original stays in history untouched.
 *
 * Two things make this the only document that may reach a closed period: the
 * OWNER confirms it with their PIN, and the reason is mandatory. Period Lock
 * asks for exactly that.
 */
@Injectable()
export class CorrectionsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.COR;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
    private readonly context: CorrectionConfirmContext,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  /**
   * Raises the correction as a draft.
   *
   * Everything that can be checked before the money moves is checked here, so
   * a correction that cannot be made is refused before it takes a number:
   * the original exists, it is confirmed, its effect is one this system knows
   * how to reverse, and nothing has corrected it already.
   */
  async create(dto: CreateCorrectionDto, userId: string): Promise<documents> {
    const original = await this.prisma.documents.findUnique({
      where: { id: dto.original_document_id },
    });
    if (!original) {
      throw new NotFoundException('Оңдоло турган документ табылган жок');
    }

    if (original.status !== doc_status.CONFIRMED) {
      throw new ConflictException(
        `${original.doc_number} — ${original.status}. Тастыкталбаган документ ` +
          'түз оңдолот же жокко чыгарылат, коррекция керек эмес (§27.1).',
      );
    }

    const verdict = correctableType(original.doc_type);
    if (!verdict.ok) {
      throw new UnprocessableEntityException({
        message: verdict.reason,
        code: 'NOT_CORRECTABLE',
      });
    }

    await this.assertFootprintIsMoneyOnly(this.prisma, original);
    await this.assertNotAlreadyCorrected(this.prisma, original);

    const effectiveDate = dto.effective_date
      ? parseBusinessDate(dto.effective_date.slice(0, 10))
      : original.business_date;

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.COR,
        // Business/Effective Date — which period the correction belongs to.
        // created_at records when it was actually entered; the two are kept
        // apart on purpose (Period Lock — Business Date жана Created Date).
        businessDate: effectiveDate,
        userId,
        comment: dto.reason,
        // The documented exception to the Period Lock, and the reason this
        // document type exists at all.
        allowClosedPeriod: true,
      });

      await tx.corrections.create({
        data: {
          document_id: document.id,
          original_document_id: original.id,
          correction_type: dto.correction_type,
          reason: dto.reason,
          // Filled at confirmation, when the movements are known and locked.
          old_value: {},
          new_value: {},
          effective_date: effectiveDate,
        },
      });

      return document;
    });
  }

  /** OWNER + PIN, always (§27.1, Closed Period Correction). */
  async confirm(
    id: string,
    dto: ConfirmCorrectionDto,
    user: { id: string; role: user_role },
    ip?: string,
  ): Promise<CorrectionFull> {
    if (user.role !== user_role.OWNER) {
      throw new UnprocessableEntityException({
        message: 'Коррекцияны ээси гана тастыктай алат (§27.1)',
        code: 'OWNER_ONLY',
      });
    }

    const { valid } = await this.auth.verifyPin(user.id, dto.pin, {
      ip: ip ?? null,
      device: `correction:${id}`,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }

    this.context.set({ userId: user.id });
    try {
      await this.documents.confirm(id, user.id);
    } finally {
      this.context.take();
    }
    return this.findOne(id);
  }

  /**
   * Posts the reversal.
   *
   * Every money movement the original made is written back with the opposite
   * sign, against this correction's own document — so the correction is a
   * document with movements like any other (§27, §42.3), and the original's
   * movements are left exactly as they were.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const decided = this.context.take();
    if (!decided || decided.userId !== userId) {
      throw new UnprocessableEntityException({
        message:
          'Коррекция ээсинин PIN коду менен гана тастыкталат — ' +
          'POST /api/corrections/:id/confirm (§27.1)',
        code: 'PIN_REQUIRED',
      });
    }

    const record = await tx.corrections.findUnique({
      where: { document_id: document.id },
    });
    if (!record) {
      throw new NotFoundException(
        `Correction body missing for ${document.doc_number}`,
      );
    }

    // Serialises two corrections racing on the same original: the second waits
    // here and then finds the first one confirmed.
    await tx.$executeRaw`
      SELECT id FROM documents WHERE id = ${record.original_document_id}::uuid FOR UPDATE
    `;

    const original = await tx.documents.findUniqueOrThrow({
      where: { id: record.original_document_id },
    });
    if (original.status !== doc_status.CONFIRMED) {
      throw new ConflictException(
        `${original.doc_number} — ${original.status}; коррекция керек эмес`,
      );
    }

    const verdict = correctableType(original.doc_type);
    if (!verdict.ok) {
      throw new UnprocessableEntityException({
        message: verdict.reason,
        code: 'NOT_CORRECTABLE',
      });
    }

    await this.assertFootprintIsMoneyOnly(tx, original);
    await this.assertNotAlreadyCorrected(tx, original, document.id);

    const movements = await tx.account_movements.findMany({
      where: { document_id: original.id },
      orderBy: { id: 'asc' },
    });
    if (movements.length === 0) {
      throw new UnprocessableEntityException({
        message: `${original.doc_number} эч кандай акча кыймылын жараткан эмес — жокко чыгарууга эч нерсе жок`,
        code: 'NOTHING_TO_REVERSE',
      });
    }

    // Locked in a fixed order so two corrections touching the same pair of
    // accounts cannot deadlock.
    const accountIds = [...new Set(movements.map((m) => m.account_id))];
    const locked = await this.accounts.lockBalances(tx, accountIds);

    const before: Record<string, string> = {};
    for (const [id, { account, balance }] of locked) {
      before[account.name] = balance.toFixed(2);
      void id;
    }

    const reversed: Prisma.InputJsonValue[] = [];
    for (const movement of movements) {
      const { account } = locked.get(movement.account_id)!;
      // Re-read rather than track a running total: the earlier reversals in
      // this same loop are already in the table, and the balance check has to
      // see them.
      const balance = await this.accounts.balanceOf(tx, movement.account_id);

      await this.accounts.postMovement(tx, {
        accountId: movement.account_id,
        documentId: document.id,
        amount: movement.amount.negated(),
        kgsValue: movement.kgs_value ? movement.kgs_value.negated() : null,
        currentBalance: balance,
        accountName: account.name,
      });

      reversed.push({
        account_id: movement.account_id,
        account: account.name,
        amount: movement.amount.negated().toFixed(2),
        currency: account.currency,
      });
    }

    const after: Record<string, string> = {};
    for (const [id, { account }] of locked) {
      after[account.name] = (await this.accounts.balanceOf(tx, id)).toFixed(2);
    }

    // Period Lock lists what a correction has to carry: the original's number
    // and date, the old and the new value, the financial effect and the stock
    // effect. All of it is here, and none of it is recomputed later.
    const oldValue: Prisma.InputJsonValue = {
      doc_number: original.doc_number,
      doc_type: original.doc_type,
      business_date: original.business_date.toISOString().slice(0, 10),
      status: original.status,
      account_movements: movements.map((m) => ({
        account_id: m.account_id,
        account: locked.get(m.account_id)!.account.name,
        amount: m.amount.toFixed(2),
      })),
      balances: before,
    };
    const newValue: Prisma.InputJsonValue = {
      reversed_by: document.doc_number,
      effective_date: record.effective_date.toISOString().slice(0, 10),
      account_movements: reversed,
      balances: after,
      // Nothing correctable today touches stock; recorded so the shape of the
      // record does not change when a stock-affecting type is added.
      stock_movements: [],
    };

    await tx.corrections.update({
      where: { document_id: document.id },
      data: { old_value: oldValue, new_value: newValue },
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'corrections',
        entityId: document.id,
        action: 'CORRECTION_POSTED',
        oldValue,
        newValue,
        reason: record.reason,
      },
      tx,
    );
  }

  /**
   * Refuses a document whose effect reaches past its money movements.
   *
   * The type allow-list already says which kinds are reversible; this is the
   * check on the individual document, because the same type can behave two
   * ways — a capital injection in som is a single movement, while one in
   * yuan also builds a currency rate layer that later documents consume
   * (§10-А). Putting such a layer back is not something §10-А describes.
   */
  private async assertFootprintIsMoneyOnly(
    db: Prisma.TransactionClient | PrismaService,
    original: documents,
  ): Promise<void> {
    const [stock, layers, consumptions] = await Promise.all([
      db.stock_movements.count({ where: { document_id: original.id } }),
      db.currency_layers.count({ where: { cex_document_id: original.id } }),
      db.currency_layer_consumptions.count({
        where: { document_id: original.id },
      }),
    ]);

    if (stock > 0) {
      throw new UnprocessableEntityException({
        message:
          `${original.doc_number} складды кыймылдаткан. Товар кайсы FIFO layerге ` +
          'кайтары билим базада жазылган эмес (§18.0, §42.19 возврат үчүн гана).',
        code: 'NOT_CORRECTABLE',
      });
    }

    if (layers > 0 || consumptions > 0) {
      throw new UnprocessableEntityException({
        message:
          `${original.doc_number} валюталык FIFO layer менен иштеген. Курс ` +
          'катмарын кайра тургузуу эрежеси билим базада жок (§10-А).',
        code: 'NOT_CORRECTABLE',
      });
    }
  }

  private async assertNotAlreadyCorrected(
    db: Prisma.TransactionClient | PrismaService,
    original: documents,
    exceptDocumentId?: string,
  ): Promise<void> {
    const existing = await db.corrections.findFirst({
      where: {
        original_document_id: original.id,
        ...(exceptDocumentId ? { document_id: { not: exceptDocumentId } } : {}),
        documents_corrections_document_idTodocuments: {
          status: doc_status.CONFIRMED,
        },
      },
      include: { documents_corrections_document_idTodocuments: true },
    });

    if (existing) {
      throw new ConflictException(
        `${original.doc_number} мурда ` +
          `${existing.documents_corrections_document_idTodocuments.doc_number} ` +
          'менен оңдолгон — эки жолу жокко чыгарылбайт (§27.1)',
      );
    }
  }

  async findOne(id: string): Promise<CorrectionFull> {
    const record = await this.prisma.corrections.findUnique({
      where: { document_id: id },
      include: {
        documents_corrections_document_idTodocuments: true,
        documents_corrections_original_document_idTodocuments: true,
      },
    });
    if (!record) {
      throw new NotFoundException('Коррекция табылган жок');
    }
    return this.toFull(record);
  }

  async findMany(): Promise<CorrectionFull[]> {
    const rows = await this.prisma.corrections.findMany({
      include: {
        documents_corrections_document_idTodocuments: true,
        documents_corrections_original_document_idTodocuments: true,
      },
      orderBy: {
        documents_corrections_document_idTodocuments: { created_at: 'desc' },
      },
    });
    return rows.map((row) => this.toFull(row));
  }

  /**
   * Recent documents this system can reverse.
   *
   * The screen offers these rather than asking for a document id: the OWNER
   * is looking for the mistake they just made, not typing a UUID off another
   * screen. Only confirmed, still-uncorrected, money-only documents appear.
   */
  async correctable(limit = 50): Promise<
    { document: documents; amount: string }[]
  > {
    const candidates = await this.prisma.documents.findMany({
      where: { doc_type: { in: [...MONEY_ONLY] }, status: doc_status.CONFIRMED },
      orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }],
      take: limit,
    });

    const rows: { document: documents; amount: string }[] = [];
    for (const document of candidates) {
      const verdict = await this.eligibility(document.id);
      if (!verdict.correctable) {
        continue;
      }
      // One figure for the list: the largest movement the document made. For
      // an expense that is what was paid; for a transfer, the sum that moved,
      // counted once rather than twice.
      const movements = await this.prisma.account_movements.findMany({
        where: { document_id: document.id },
      });
      const amount = movements.reduce(
        (largest, movement) => Prisma.Decimal.max(largest, movement.amount.abs()),
        new Prisma.Decimal(0),
      );
      rows.push({ document, amount: amount.toFixed(2) });
    }
    return rows;
  }

  /**
   * Whether a document can be corrected, and what to do instead when it
   * cannot. The screen asks before offering the button, so the person is not
   * refused after typing a reason.
   */
  async eligibility(
    documentId: string,
  ): Promise<{ correctable: boolean; reason: string | null; document: documents }> {
    const document = await this.prisma.documents.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Документ табылган жок');
    }

    try {
      if (document.status !== doc_status.CONFIRMED) {
        return {
          correctable: false,
          reason: `${document.doc_number} — ${document.status}; коррекция тастыкталган документке гана керек (§27.1)`,
          document,
        };
      }
      const verdict = correctableType(document.doc_type);
      if (!verdict.ok) {
        return { correctable: false, reason: verdict.reason, document };
      }
      await this.assertFootprintIsMoneyOnly(this.prisma, document);
      await this.assertNotAlreadyCorrected(this.prisma, document);
      return { correctable: true, reason: null, document };
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        const response = error.getResponse();
        const message =
          typeof response === 'string'
            ? response
            : ((response as { message?: string }).message ?? error.message);
        return { correctable: false, reason: message, document };
      }
      throw error;
    }
  }

  private toFull(row: {
    documents_corrections_document_idTodocuments: documents;
    documents_corrections_original_document_idTodocuments: documents;
  } & corrections): CorrectionFull {
    const {
      documents_corrections_document_idTodocuments: document,
      documents_corrections_original_document_idTodocuments: original,
      ...rest
    } = row;
    return { ...rest, document, original };
  }
}
