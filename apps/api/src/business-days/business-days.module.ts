import { Global, Module } from '@nestjs/common';
import { BusinessDaysController } from './business-days.controller';
import { BusinessDaysRepository } from './business-days.repository';
import { BusinessDaysService } from './business-days.service';

@Global()
@Module({
  controllers: [BusinessDaysController],
  providers: [BusinessDaysService, BusinessDaysRepository],
  exports: [BusinessDaysService],
})
export class BusinessDaysModule {}
