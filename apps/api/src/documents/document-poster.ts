import { Prisma, doc_type, documents } from '@prisma/client';

/**
 * Type-specific work that runs when a document is confirmed.
 *
 * Confirming is where a document stops being a draft and becomes a posted
 * fact — money moves, stock moves, ledgers change. Each document type
 * registers its own posting logic here, and DocumentsService runs it inside
 * the same transaction as the status change, so a confirmed document and its
 * effects commit together or not at all.
 */
export interface DocumentPoster {
  readonly docType: doc_type;
  post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void>;
}
