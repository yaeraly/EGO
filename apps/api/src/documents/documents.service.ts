import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, doc_status, doc_type, documents } from '@prisma/client';
import { AuditService, Db } from '../audit/audit.service';
import { BusinessDaysService } from '../business-days/business-days.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsRepository } from './documents.repository';
import { DocumentPostingRegistry } from './document-posting.registry';
import { formatDocumentNumber, sequenceYear } from './document-number';

/**
 * Numbering serializes concurrent creations of the same type on one sequence
 * row, so a burst queues rather than running in parallel. The wait allows for
 * that queue plus the time to obtain a pooled connection; the timeout bounds a
 * single document's own work.
 */
const NUMBERING_TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

export interface CreateDocumentParams {
  docType: doc_type;
  /** Period Lock business date — the day the document is booked to. */
  businessDate: Date;
  userId: string;
  comment?: string | null;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly repository: DocumentsRepository,
    private readonly posting: DocumentPostingRegistry,
    private readonly businessDays: BusinessDaysService,
  ) {}

  /**
   * Reserves the next number for a type and year.
   *
   * `SELECT ... FOR UPDATE` holds the sequence row for the rest of the
   * transaction, so concurrent creations of the same type queue behind each
   * other and each sees the previous one's increment. Two callers can never
   * read the same `last_number`.
   *
   * The counter only ever moves forward. Cancelling a document leaves it
   * untouched, so a cancelled number is retired, never handed out again.
   */
  private async nextSequence(
    tx: Prisma.TransactionClient,
    docType: doc_type,
    year: number,
  ): Promise<number> {
    const lastNumber = await this.repository.lockSequence(tx, docType, year);
    const next = lastNumber + 1;
    await this.repository.setSequence(tx, docType, year, next);
    return next;
  }

  /**
   * Creates a document header inside the caller's transaction.
   *
   * Concrete document types (CAP, TRN, CEX, ...) call this and write their own
   * rows in the same transaction, so a header never exists without its body.
   */
  async create(
    tx: Prisma.TransactionClient,
    params: CreateDocumentParams,
  ): Promise<documents> {
    // Period Lock first: a closed day must refuse the document before a
    // sequence number is spent on it.
    await this.businessDays.ensureOpen(tx, params.businessDate);

    // The Numbering Standard counts by creation year (Bishkek), which is not
    // necessarily the business date's year.
    const year = sequenceYear();
    const sequence = await this.nextSequence(tx, params.docType, year);

    const document = await this.repository.insert(tx, {
      docType: params.docType,
      docNumber: formatDocumentNumber(params.docType, year, sequence),
      businessDate: params.businessDate,
      createdBy: params.userId,
      comment: params.comment ?? null,
    });

    await this.audit.log(
      {
        userId: params.userId,
        documentId: document.id,
        entity: 'documents',
        entityId: document.id,
        action: 'DOCUMENT_CREATED',
        newValue: {
          doc_type: document.doc_type,
          doc_number: document.doc_number,
          business_date: document.business_date.toISOString(),
          status: document.status,
        },
      },
      tx,
    );

    return document;
  }

  /** Opens its own transaction. For document types with no body of their own. */
  createStandalone(params: CreateDocumentParams): Promise<documents> {
    return this.prisma.$transaction(
      (tx) => this.create(tx, params),
      NUMBERING_TX_OPTIONS,
    );
  }

  /**
   * Guards every mutation of a document's own data.
   *
   * A confirmed document is a posted fact: it is corrected with a COR
   * document, never edited in place. A rejected attempt is itself worth
   * recording, so the refusal is audited before the 409 is raised.
   */
  async assertDraft(
    tx: Db,
    documentId: string,
    userId: string,
    attemptedAction: string,
  ): Promise<documents> {
    const document = await this.repository.findById(tx, documentId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (document.status === doc_status.DRAFT) {
      return document;
    }

    // Deliberately NOT on `tx`: the 409 below rolls that transaction back, and
    // an entry written inside it would roll back with the refusal it records.
    // The rejection is a fact about an attempt, so it commits on its own
    // connection and survives.
    await this.audit.log({
      userId,
      documentId,
      entity: 'documents',
      entityId: documentId,
      action: 'DOCUMENT_UPDATE_REJECTED',
      oldValue: { status: document.status },
      reason: `${attemptedAction} is not allowed on a ${document.status} document`,
    });

    throw new ConflictException(
      `Document ${document.doc_number} is ${document.status} and can no longer be changed`,
    );
  }

  /** DRAFT -> CONFIRMED. */
  async confirm(documentId: string, userId: string): Promise<documents> {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(tx, documentId, userId, 'CONFIRM');

      // Type-specific posting runs in this same transaction: if it fails —
      // insufficient balance, say — the confirmation fails with it and the
      // document stays a draft.
      await this.posting.get(draft.doc_type)?.post(tx, draft, userId);

      const document = await this.repository.markConfirmed(tx, documentId, userId);

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'documents',
          entityId: documentId,
          action: 'DOCUMENT_CONFIRMED',
          oldValue: { status: doc_status.DRAFT },
          newValue: { status: doc_status.CONFIRMED },
        },
        tx,
      );

      return document;
    }, NUMBERING_TX_OPTIONS);
  }

  /**
   * DRAFT -> CANCELLED.
   *
   * Only a draft can be cancelled. A confirmed document has already moved
   * money or stock; reversing it is a COR document, not a status flip.
   */
  async cancel(
    documentId: string,
    userId: string,
    reason?: string | null,
  ): Promise<documents> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDraft(tx, documentId, userId, 'CANCEL');

      const document = await this.repository.markCancelled(tx, documentId);

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'documents',
          entityId: documentId,
          action: 'DOCUMENT_CANCELLED',
          oldValue: { status: doc_status.DRAFT },
          newValue: { status: doc_status.CANCELLED },
          reason: reason ?? null,
        },
        tx,
      );

      return document;
    });
  }

  async updateComment(
    documentId: string,
    userId: string,
    comment: string | null,
  ): Promise<documents> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.assertDraft(
        tx,
        documentId,
        userId,
        'UPDATE_COMMENT',
      );

      const document = await this.repository.updateComment(tx, documentId, comment);

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'documents',
          entityId: documentId,
          action: 'DOCUMENT_UPDATED',
          oldValue: { comment: current.comment },
          newValue: { comment },
        },
        tx,
      );

      return document;
    });
  }

  async findOne(id: string): Promise<documents> {
    const document = await this.repository.findById(this.prisma, id);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return document;
  }

  findMany(filter: {
    docType?: doc_type;
    status?: doc_status;
    businessDate?: Date;
  }): Promise<documents[]> {
    return this.repository.findMany(filter);
  }
}
