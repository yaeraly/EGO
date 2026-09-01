import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsRepository,
    AnalyticsService,
    AnalyticsRepository,
  ],
  exports: [ReportsService, AnalyticsService],
})
export class ReportsModule {}
