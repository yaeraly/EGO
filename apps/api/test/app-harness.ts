import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

/**
 * Tables cleared between tests, children before parents. `_prisma_migrations`
 * is deliberately absent — truncating it would strand the schema baseline.
 */
const TRUNCATE_ORDER = [
  'security_log',
  'audit_log',
  'account_movements',
  'currency_layer_consumptions',
  'currency_layers',
  'account_transfers',
  'currency_exchanges',
  'daily_cash_handovers',
  'capital_docs',
  'withdrawal_docs',
  'documents',
  'doc_sequences',
  'business_days',
  'business_months',
  'payment_accounts',
  'investors',
  'settings',
  'users',
] as const;

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

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TRUNCATE_ORDER.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
