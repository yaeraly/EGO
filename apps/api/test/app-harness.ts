import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

let cachedTables: string[] | null = null;

/**
 * Every table in the schema except Prisma's migration ledger.
 *
 * Discovered from the database rather than listed by hand: a hand-written
 * list silently stops covering tables as modules land, and a leftover row
 * then fails a later suite in a way that looks like a product bug. Learned
 * from exactly that — a stale expense_categories row surviving between runs.
 */
async function truncatableTables(prisma: PrismaClient): Promise<string[]> {
  cachedTables ??= (
    await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name
    `
  ).map((row) => row.table_name);
  return cachedTables;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await truncatableTables(prisma);
  // CASCADE settles the ordering, so the tables need no dependency sort.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
