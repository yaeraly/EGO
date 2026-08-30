import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { notifications, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AlertsService, DigestResult } from './alerts.service';
import { NotificationsService } from './notifications.service';

/** In-app alerts (§39). Push and Telegram are explicitly out of scope here. */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
  ) {}

  /** A user only ever sees their own alerts. */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('unread', new ParseBoolPipe({ optional: true })) unread?: boolean,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<{ unread_count: number; items: notifications[] }> {
    return {
      unread_count: await this.notifications.countUnread(user.id),
      items: await this.notifications.list(user.id, {
        unreadOnly: unread ?? false,
        limit,
      }),
    };
  }

  @Post(':id/read')
  async markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.notifications.markRead(BigInt(id), user.id);
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ marked: number }> {
    return { marked: await this.notifications.markAllRead(user.id) };
  }

  /**
   * Runs the digest now, for an OWNER who does not want to wait for 09:00.
   *
   * Safe to call repeatedly: the day's alerts are deduped, so a second run
   * reports what it found without raising anything twice.
   */
  @Roles(user_role.OWNER)
  @Post('run-digest')
  runDigest(): Promise<DigestResult> {
    return this.alerts.runDailyDigest();
  }
}
