import { Global, Module } from '@nestjs/common';
import { BusinessDaysController } from './business-days.controller';
import { BusinessDaysRepository } from './business-days.repository';
import { BusinessDaysService } from './business-days.service';
import { DayCloseBlockerRegistry } from './day-close-blockers';

@Global()
@Module({
  controllers: [BusinessDaysController],
  providers: [BusinessDaysService, BusinessDaysRepository, DayCloseBlockerRegistry],
  exports: [BusinessDaysService, DayCloseBlockerRegistry],
})
export class BusinessDaysModule {}
