import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BusinessDaysModule } from '../business-days/business-days.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TransfersModule } from '../transfers/transfers.module';
import { CashHandoversService } from './cash-handovers.service';
import {
  CashHandoversController,
  DayCloseController,
  MonthCloseController,
} from './day-close.controller';
import { DayCloseService } from './day-close.service';
import { DraftDocumentsBlocker } from './draft-documents.blocker';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    BusinessDaysModule,
    TransfersModule,
  ],
  controllers: [CashHandoversController, DayCloseController, MonthCloseController],
  providers: [CashHandoversService, DayCloseService, DraftDocumentsBlocker],
  exports: [CashHandoversService, DayCloseService],
})
export class DayCloseModule {}
