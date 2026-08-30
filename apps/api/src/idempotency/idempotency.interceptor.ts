import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { Observable, from, of, switchMap } from 'rxjs';
import { createHash } from 'node:crypto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { IdempotencyRepository } from './idempotency.repository';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_KEY_LENGTH = 200;

/**
 * Duplicate-request protection for mutating endpoints (Connectivity section).
 *
 * EGOMOT is online-only, so a connection dropped mid-confirm leaves the client
 * unsure whether the document posted. Retrying blindly would create a second
 * sale, payment or movement. With an Idempotency-Key header the retry returns
 * the first response instead of running again.
 *
 * The header is optional — the rule is that endpoints *accept* a key, not that
 * they demand one — and the key is scoped to the caller, so two people cannot
 * collide on a client-generated value.
 *
 * Only successful responses are stored. A failed request releases its claim so
 * the client can genuinely retry; replaying a 409 would be worse than useless.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly repository: IdempotencyRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthenticatedUser }>();

    const key = this.readKey(request);
    // No key, a read, or an unauthenticated route: nothing to deduplicate.
    // The key is per-user, so it needs an authenticated caller to scope to.
    if (!key || !MUTATING_METHODS.has(request.method) || !request.user) {
      return next.handle();
    }

    const userId = request.user.id;
    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = hashBody(request.body);

    return from(
      this.repository.claim({ key, userId, endpoint, requestHash }),
    ).pipe(
      switchMap((claimed) =>
        claimed
          ? this.runAndRecord(context, next, { key, userId })
          : from(this.replay(key, userId, requestHash)),
      ),
    );
  }

  private readKey(request: Request): string | null {
    const raw = request.header(IDEMPOTENCY_HEADER);
    if (!raw) {
      return null;
    }
    const key = raw.trim();
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new ConflictException(
        `Idempotency-Key must be 1 to ${MAX_KEY_LENGTH} characters`,
      );
    }
    return key;
  }

  private runAndRecord(
    context: ExecutionContext,
    next: CallHandler,
    claim: { key: string; userId: string },
  ): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      switchMap((body: unknown) =>
        from(
          this.repository.complete({
            ...claim,
            statusCode: response.statusCode,
            body: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          }),
        ).pipe(switchMap(() => of(body))),
      ),
      // A failed request must not be replayable: release the claim so the
      // client's retry actually runs.
      catchAndRelease(() => this.repository.release(claim.key, claim.userId)),
    );
  }

  private async replay(
    key: string,
    userId: string,
    requestHash: string,
  ): Promise<unknown> {
    const existing = await this.repository.find(key, userId);
    if (!existing) {
      // The holder failed and released between the claim and this read.
      throw new ConflictException(
        'This Idempotency-Key was just released; retry the request',
      );
    }
    if (existing.request_hash !== requestHash) {
      throw new ConflictException(
        'This Idempotency-Key was already used for a different request',
      );
    }
    if (existing.status_code === null) {
      throw new ConflictException(
        'A request with this Idempotency-Key is still in progress',
      );
    }
    return existing.response_body;
  }
}

/** sha256 of the body, so a reused key with different content is detectable. */
function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}

function catchAndRelease(release: () => Promise<void>) {
  return <T>(source: Observable<T>): Observable<T> =>
    new Observable<T>((subscriber) => {
      const subscription = source.subscribe({
        next: (value) => subscriber.next(value),
        complete: () => subscriber.complete(),
        error: (error: unknown) => {
          void release().finally(() => subscriber.error(error));
        },
      });
      return () => subscription.unsubscribe();
    });
}
