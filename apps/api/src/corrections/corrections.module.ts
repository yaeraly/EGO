import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CorrectionsController } from './corrections.controller';
import {
  CorrectionConfirmContext,
  CorrectionsService,
} from './corrections.service';

@Module({
  imports: [PrismaModule, AuditModule, DocumentsModule, AccountsModule, AuthModule],
  controllers: [CorrectionsController],
  providers: [CorrectionsService, CorrectionConfirmContext],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}
