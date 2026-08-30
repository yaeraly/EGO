import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, notifications, user_role, user_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationKindName } from './notification-kinds';
import { NotificationsRepository } from './notifications.repository';

export interface NotifyParams {
  userId: string;
  kind: NotificationKindName;
  title: string;
  body: string;
  payload?: Prisma.InputJsonValue | null;
  /**
   * What makes this alert "the same one" — usually kind plus subject plus the
   * Bishkek date, so a re-run on the same day is a no-op (§39).
   */
  dedupeKey: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: NotificationsRepository,
  ) {}

  /** Delivers one alert, or nothing if that user already has it. */
  async notify(params: NotifyParams): Promise<boolean> {
    const created = await this.repository.insertIfNew({
      userId: params.userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      payload: params.payload ?? null,
      dedupeKey: params.dedupeKey,
    });
    return created > 0;
  }

  /** Sends the same alert to every active OWNER; returns how many landed. */
  async notifyOwners(params: Omit<NotifyParams, 'userId'>): Promise<number> {
    const owners = await this.activeOwners();

    let delivered = 0;
    for (const owner of owners) {
      if (await this.notify({ ...params, userId: owner.id })) {
        delivered += 1;
      }
    }
    return delivered;
  }

  activeOwners(): Promise<{ id: string }[]> {
    return this.prisma.users.findMany({
      where: { role: user_role.OWNER, status: user_status.ACTIVE },
      select: { id: true },
      orderBy: { created_at: 'asc' },
    });
  }

  list(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<notifications[]> {
    return this.repository.findForUser(userId, {
      unreadOnly: options.unreadOnly ?? false,
      limit: Math.min(options.limit ?? 50, 200),
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.repository.countUnread(userId);
  }

  /**
   * Marks one notification read.
   *
   * Scoped to the caller: reading someone else's alert is not a thing a user
   * may do, and an id from another user must not silently succeed.
   */
  async markRead(id: bigint, userId: string): Promise<void> {
    const { count } = await this.repository.markRead(id, userId);
    if (count === 0) {
      const exists = await this.prisma.notifications.findFirst({
        where: { id, user_id: userId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException('Notification not found');
      }
      // It exists and is already read — nothing to do.
    }
  }

  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.repository.markAllRead(userId);
    return count;
  }
}
