import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DiscrepanciesModule } from '../discrepancies/discrepancies.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  imports: [PrismaModule, DocumentsModule, DiscrepanciesModule, AuditModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
