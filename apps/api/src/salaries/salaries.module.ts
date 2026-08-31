import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { SalariesController } from './salaries.controller';
import { SalariesService } from './salaries.service';

@Module({
  imports: [PrismaModule, AuditModule, DocumentsModule, UsersModule, AccountsModule],
  controllers: [SalariesController],
  providers: [SalariesService],
  exports: [SalariesService],
})
export class SalariesModule {}
