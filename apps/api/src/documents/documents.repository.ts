import { Injectable } from '@nestjs/common';
import { Prisma, doc_status, doc_type, documents } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

export interface DocumentRow {
  docType: doc_type;
  docNumber: string;
  businessDate: Date;
  createdBy: string;
  comment: string | null;
}

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Takes the sequence row for a type and year and holds it for the rest of
   * the transaction (§ Document Numbering Standard, rule 9).
   *
   * The row is inserted first because it does not exist for the first document
   * of a type and year; a concurrent inserter simply wins and this caller
   * falls through to the lock either way. FOR UPDATE is what makes concurrent
   * creations queue instead of reading the same last_number.
   */
  async lockSequence(
    tx: Prisma.TransactionClient,
    docType: doc_type,
    year: number,
  ): Promise<number> {
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

    return locked.last_number;
  }

  async setSequence(
    tx: Prisma.TransactionClient,
    docType: doc_type,
    year: number,
    lastNumber: number,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE doc_sequences
      SET last_number = ${lastNumber}
      WHERE doc_type = ${docType}::doc_type AND year = ${year}
    `;
  }

  insert(tx: Prisma.TransactionClient, row: DocumentRow): Promise<documents> {
    return tx.documents.create({
      data: {
        doc_type: row.docType,
        doc_number: row.docNumber,
        business_date: row.businessDate,
        status: doc_status.DRAFT,
        created_by: row.createdBy,
        comment: row.comment,
      },
    });
  }

  findById(db: Db, id: string): Promise<documents | null> {
    return db.documents.findUnique({ where: { id } });
  }

  findTypeById(db: Db, id: string): Promise<{ doc_type: doc_type } | null> {
    return db.documents.findUnique({
      where: { id },
      select: { doc_type: true },
    });
  }

  markConfirmed(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
  ): Promise<documents> {
    return tx.documents.update({
      where: { id },
      data: {
        status: doc_status.CONFIRMED,
        confirmed_by: userId,
        confirmed_at: new Date(),
      },
    });
  }

  markCancelled(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<documents> {
    return tx.documents.update({
      where: { id },
      data: { status: doc_status.CANCELLED, cancelled_at: new Date() },
    });
  }

  updateComment(
    tx: Prisma.TransactionClient,
    id: string,
    comment: string | null,
  ): Promise<documents> {
    return tx.documents.update({ where: { id }, data: { comment } });
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
