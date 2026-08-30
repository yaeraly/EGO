import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../common/db';
import { AuditRepository } from './audit.repository';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Who acted. Null only for system-initiated changes. */
  userId?: string | null;
  documentId?: string | null;
  /** Table the change concerns, e.g. 'documents', 'payment_accounts'. */
  entity: string;
  entityId?: string | null;
  /** Past-tense event name, e.g. 'DOCUMENT_CONFIRMED'. */
  action: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  /** Why — required for overrides and corrections. */
  reason?: string | null;
}

/**
 * Audit Log (§27) — append-only.
 *
 * Every service writes here through this one entry point. There is
 * deliberately no update or delete method: the log's value is that a recorded
 * event cannot later be edited away. The database enforces the same thing, so
 * a bypass through raw SQL fails too.
 *
 * Pass the surrounding transaction as `db` so the entry commits or rolls back
 * with the change it describes — an audit record for a change that never
 * happened is worse than none.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuditRepository,
  ) {}

  async log(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await this.repository.insert(
      {
        userId: entry.userId ?? null,
        documentId: entry.documentId ?? null,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        action: entry.action,
        oldValue: entry.oldValue ?? Prisma.DbNull,
        newValue: entry.newValue ?? Prisma.DbNull,
        reason: entry.reason ?? null,
      },
      db,
    );
  }
}

export type { Db };
