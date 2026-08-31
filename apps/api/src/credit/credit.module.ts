import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { CreditRepository } from './credit.repository';
import { CreditService } from './credit.service';
import { DebtAlertsService } from './debt-alerts.service';

@Module({
  imports: [PrismaModule, CustomersModule, SettingsModule, NotificationsModule],
  providers: [CreditService, CreditRepository, DebtAlertsService],
  exports: [CreditService, CreditRepository, DebtAlertsService],
})
export class CreditModule {}
