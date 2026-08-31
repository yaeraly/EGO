import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { LedgersModule } from '../ledgers/ledgers.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DiscrepanciesController } from './discrepancies.controller';
import { DiscrepanciesService } from './discrepancies.service';

@Module({
  imports: [PrismaModule, DocumentsModule, LedgersModule, AuditModule],
  controllers: [DiscrepanciesController],
  providers: [DiscrepanciesService],
  exports: [DiscrepanciesService],
})
export class DiscrepanciesModule {}
