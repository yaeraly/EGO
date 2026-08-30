import { Controller, Get, Param } from '@nestjs/common';
import { business_days } from '@prisma/client';
import { parseBusinessDate } from '../documents/business-date';
import { BusinessDaysService } from './business-days.service';

/**
 * Read-only. Closing a day is Priority 2; until then days only ever open, on
 * first use.
 */
@Controller('business-days')
export class BusinessDaysController {
  constructor(private readonly businessDays: BusinessDaysService) {}

  @Get()
  findMany(): Promise<business_days[]> {
    return this.businessDays.findMany();
  }

  @Get(':date')
  findOne(@Param('date') date: string): Promise<business_days> {
    return this.businessDays.findOne(parseBusinessDate(date));
  }
}
