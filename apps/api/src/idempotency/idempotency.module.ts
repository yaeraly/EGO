import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyRepository } from './idempotency.repository';

/**
 * Registered globally: every mutating endpoint accepts an Idempotency-Key,
 * rather than each controller having to remember to opt in (CLAUDE.md,
 * Security: "Бардык mutating endpoint'тер idempotency key кабыл алат").
 */
@Global()
@Module({
  providers: [
    IdempotencyRepository,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IdempotencyRepository],
})
export class IdempotencyModule {}
