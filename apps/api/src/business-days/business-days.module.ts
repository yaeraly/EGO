import { Global, Module } from '@nestjs/common';
import { BusinessDaysController } from './business-days.controller';
import { BusinessDaysService } from './business-days.service';

@Global()
@Module({
  controllers: [BusinessDaysController],
  providers: [BusinessDaysService],
  exports: [BusinessDaysService],
})
export class BusinessDaysModule {}
