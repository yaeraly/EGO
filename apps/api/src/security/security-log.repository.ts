import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SecurityLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Append-only: there is deliberately no update or delete here. */
  async insert(data: {
    event: string;
    userId: string | null;
    device: string | null;
    ip: string | null;
  }): Promise<void> {
    await this.prisma.security_log.create({
      data: {
        event: data.event,
        user_id: data.userId,
        device: data.device,
        ip: data.ip,
      },
    });
  }
}
