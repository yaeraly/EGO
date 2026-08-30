import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Security Log event names. The reference schema (db/egomot_schema.sql,
 * `security_log.event`) documents exactly these five.
 */
export const SecurityEvent = {
  LOGIN_OK: 'LOGIN_OK',
  LOGIN_FAIL: 'LOGIN_FAIL',
  LOGOUT: 'LOGOUT',
  PIN_OK: 'PIN_OK',
  PIN_FAIL: 'PIN_FAIL',
} as const;

export type SecurityEventName =
  (typeof SecurityEvent)[keyof typeof SecurityEvent];

export interface SecurityLogContext {
  userId?: string | null;
  device?: string | null;
  ip?: string | null;
}

/**
 * Security Log — kept separate from the Audit Log (Security section).
 *
 * Records authentication and PIN outcomes only. It never receives credentials:
 * no password, no PIN, hashed or otherwise.
 */
@Injectable()
export class SecurityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    event: SecurityEventName,
    ctx: SecurityLogContext = {},
  ): Promise<void> {
    await this.prisma.security_log.create({
      data: {
        event,
        user_id: ctx.userId ?? null,
        device: ctx.device ?? null,
        ip: ctx.ip ?? null,
      },
    });
  }
}
