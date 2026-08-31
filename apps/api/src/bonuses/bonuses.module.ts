import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { BonusesController } from './bonuses.controller';
import { BonusesService } from './bonuses.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    DocumentsModule,
    AccountsModule,
    SettingsModule,
  ],
  controllers: [BonusesController],
  providers: [BonusesService],
  exports: [BonusesService],
})
export class BonusesModule {}
