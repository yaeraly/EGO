import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Append-only (§27): no update or delete method exists, by design. */
  async insert(
    data: {
      userId: string | null;
      documentId: string | null;
      entity: string;
      entityId: string | null;
      action: string;
      oldValue: Prisma.InputJsonValue | typeof Prisma.DbNull;
      newValue: Prisma.InputJsonValue | typeof Prisma.DbNull;
      reason: string | null;
    },
    db: Db = this.prisma,
  ): Promise<void> {
    await db.audit_log.create({
      data: {
        user_id: data.userId,
        document_id: data.documentId,
        entity: data.entity,
        entity_id: data.entityId,
        action: data.action,
        old_value: data.oldValue,
        new_value: data.newValue,
        reason: data.reason,
      },
    });
  }
}
