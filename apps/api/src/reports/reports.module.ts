import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlansModule } from '../plans/plans.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import { PerformanceRepository } from './performance.repository';
import { PerformanceService } from './performance.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, SettingsModule, PlansModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsRepository,
    AnalyticsService,
    AnalyticsRepository,
    PerformanceService,
    PerformanceRepository,
  ],
  exports: [ReportsService, AnalyticsService, PerformanceService],
})
export class ReportsModule {}
