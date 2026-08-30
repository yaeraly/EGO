import { Injectable } from '@nestjs/common';
import { Prisma, idempotency_keys } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claims the key, or reports that someone already holds it.
   *
   * The claim is the INSERT itself: the primary key makes exactly one of two
   * concurrent retries win, so the loser can be told the work is already in
   * flight rather than doing it a second time.
   */
  async claim(data: {
    key: string;
    userId: string;
    endpoint: string;
    requestHash: string;
  }): Promise<boolean> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash)
      VALUES (${data.key}, ${data.userId}::uuid, ${data.endpoint}, ${data.requestHash})
      ON CONFLICT (key, user_id) DO NOTHING
    `;
    return inserted === 1;
  }

  find(key: string, userId: string): Promise<idempotency_keys | null> {
    return this.prisma.idempotency_keys.findUnique({
      where: { key_user_id: { key, user_id: userId } },
    });
  }

  async complete(data: {
    key: string;
    userId: string;
    statusCode: number;
    body: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  }): Promise<void> {
    await this.prisma.idempotency_keys.update({
      where: { key_user_id: { key: data.key, user_id: data.userId } },
      data: {
        status_code: data.statusCode,
        response_body: data.body,
        completed_at: new Date(),
      },
    });
  }

  /** Releases a claim whose request failed, so the client can retry. */
  async release(key: string, userId: string): Promise<void> {
    await this.prisma.idempotency_keys.deleteMany({
      where: { key, user_id: userId, status_code: null },
    });
  }
}
