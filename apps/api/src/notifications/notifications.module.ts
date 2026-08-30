import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { LedgersModule } from '../ledgers/ledgers.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AlertsService } from './alerts.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, AccountsModule, LedgersModule, SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, AlertsService],
  exports: [NotificationsService, AlertsService],
})
export class NotificationsModule {}
