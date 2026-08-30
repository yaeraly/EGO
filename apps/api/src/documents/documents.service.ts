import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, doc_status, doc_type, documents } from '@prisma/client';
import { AuditService, Db } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
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
    // The row may not exist yet on the first document of a type and year.
    // A concurrent inserter simply wins; this one falls through to the lock.
    await tx.$executeRaw`
      INSERT INTO doc_sequences (doc_type, year, last_number)
      VALUES (${docType}::doc_type, ${year}, 0)
      ON CONFLICT (doc_type, year) DO NOTHING
    `;

    const [locked] = await tx.$queryRaw<{ last_number: number }[]>`
      SELECT last_number
      FROM doc_sequences
      WHERE doc_type = ${docType}::doc_type AND year = ${year}
      FOR UPDATE
    `;

    const next = locked.last_number + 1;

    await tx.$executeRaw`
      UPDATE doc_sequences
      SET last_number = ${next}
      WHERE doc_type = ${docType}::doc_type AND year = ${year}
    `;

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
    const year = sequenceYear(params.businessDate);
    const sequence = await this.nextSequence(tx, params.docType, year);

    const document = await tx.documents.create({
      data: {
        doc_type: params.docType,
        doc_number: formatDocumentNumber(params.docType, year, sequence),
        business_date: params.businessDate,
        status: doc_status.DRAFT,
        created_by: params.userId,
        comment: params.comment ?? null,
      },
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
    const document = await tx.documents.findUnique({
      where: { id: documentId },
    });
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
      await this.assertDraft(tx, documentId, userId, 'CONFIRM');

      const document = await tx.documents.update({
        where: { id: documentId },
        data: {
          status: doc_status.CONFIRMED,
          confirmed_by: userId,
          confirmed_at: new Date(),
        },
      });

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
    });
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

      const document = await tx.documents.update({
        where: { id: documentId },
        data: { status: doc_status.CANCELLED, cancelled_at: new Date() },
      });

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

      const document = await tx.documents.update({
        where: { id: documentId },
        data: { comment },
      });

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
    const document = await this.prisma.documents.findUnique({ where: { id } });
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
    return this.prisma.documents.findMany({
      where: {
        doc_type: filter.docType,
        status: filter.status,
        business_date: filter.businessDate,
      },
      orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }],
      take: 200,
    });
  }
}
