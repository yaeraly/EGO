import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditModule } from '../credit/credit.module';
import { PlansModule } from '../plans/plans.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import { PerformanceRepository } from './performance.repository';
import { PerformanceService } from './performance.service';
import { DashboardService } from './dashboard.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, SettingsModule, PlansModule, CreditModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsRepository,
    AnalyticsService,
    AnalyticsRepository,
    PerformanceService,
    PerformanceRepository,
    DashboardService,
  ],
  exports: [
    ReportsService,
    AnalyticsService,
    PerformanceService,
    DashboardService,
  ],
})
export class ReportsModule {}
