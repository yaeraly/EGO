import { Injectable } from '@nestjs/common';
import { SecurityLogRepository } from './security-log.repository';

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
  constructor(private readonly repository: SecurityLogRepository) {}

  async log(
    event: SecurityEventName,
    ctx: SecurityLogContext = {},
  ): Promise<void> {
    await this.repository.insert({
      event,
      userId: ctx.userId ?? null,
      device: ctx.device ?? null,
      ip: ctx.ip ?? null,
    });
  }
}
