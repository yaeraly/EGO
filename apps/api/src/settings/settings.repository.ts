import { Injectable } from '@nestjs/common';
import { Prisma, settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<settings[]> {
    return this.prisma.settings.findMany({ orderBy: { key: 'asc' } });
  }

  findByKey(key: string): Promise<settings | null> {
    return this.prisma.settings.findUnique({ where: { key } });
  }

  upsert(data: {
    key: string;
    value: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    description: string | null | undefined;
    userId: string;
  }): Promise<settings> {
    return this.prisma.settings.upsert({
      where: { key: data.key },
      create: {
        key: data.key,
        value: data.value,
        description: data.description,
        updated_by: data.userId,
      },
      update: {
        value: data.value,
        description: data.description,
        updated_by: data.userId,
        updated_at: new Date(),
      },
    });
  }

  async remove(key: string): Promise<void> {
    await this.prisma.settings.delete({ where: { key } });
  }
}
