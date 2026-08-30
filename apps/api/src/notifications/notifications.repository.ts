import { Injectable } from '@nestjs/common';
import { Prisma, notifications } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NewNotification {
  userId: string;
  kind: string;
  title: string;
  body: string;
  payload: Prisma.InputJsonValue | null;
  dedupeKey: string;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts one notification, or does nothing if the same user already has
   * one with that dedupe key.
   *
   * The digest is allowed to run more than once a day — a restart, a manual
   * re-run, two app instances — and the UNIQUE (user_id, dedupe_key) index is
   * what stops that turning into duplicate alerts. Returns the number of rows
   * actually created so a caller can report what the run did.
   */
  async insertIfNew(notification: NewNotification): Promise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO notifications (user_id, kind, title, body, payload, dedupe_key)
      VALUES (
        ${notification.userId}::uuid,
        ${notification.kind},
        ${notification.title},
        ${notification.body},
        ${notification.payload === null
          ? Prisma.sql`NULL`
          : Prisma.sql`${JSON.stringify(notification.payload)}::jsonb`},
        ${notification.dedupeKey}
      )
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
    `;
  }

  findForUser(
    userId: string,
    options: { unreadOnly: boolean; limit: number },
  ): Promise<notifications[]> {
    return this.prisma.notifications.findMany({
      where: {
        user_id: userId,
        ...(options.unreadOnly ? { read_at: null } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: options.limit,
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notifications.count({
      where: { user_id: userId, read_at: null },
    });
  }

  /** Marks one notification read, but only if it belongs to that user. */
  markRead(id: bigint, userId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.notifications.updateMany({
      where: { id, user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
  }

  markAllRead(userId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.notifications.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
  }
}
