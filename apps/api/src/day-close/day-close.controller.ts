import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { business_days, business_months, user_role } from '@prisma/client';
import { Request } from 'express';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { currentBusinessDate, parseBusinessDate } from '../documents/business-date';
import {
  CashHandoversService,
  DaySummary,
  HandoverView,
} from './cash-handovers.service';
import {
  CloseDayDto,
  CloseMonthDto,
  CreateCashHandoverDto,
  ReopenMonthDto,
} from './dto/day-close.dto';
import { DayCloseService } from './day-close.service';

function dateOf(value?: string): Date {
  return value ? parseBusinessDate(value) : currentBusinessDate();
}

/** The salesperson's own end of day (§20). */
@Controller('cash-handovers')
export class CashHandoversController {
  constructor(private readonly handovers: CashHandoversService) {}

  /**
   * The day as the system sees it. A salesperson sees their own; the OWNER
   * may look at anyone's (§2).
   */
  @Get('summary')
  summary(
    @Query('business_date') businessDate: string | undefined,
    @Query('user_id') userId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DaySummary> {
    const subject =
      user.role === user_role.OWNER && userId ? userId : user.id;
    return this.handovers.summary(subject, dateOf(businessDate));
  }

  @Post()
  create(
    @Body() dto: CreateCashHandoverDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HandoverView> {
    return this.handovers.create(dto, user.id);
  }

  @Get()
  findMany(
    @Query('business_date') businessDate?: string,
  ): Promise<HandoverView[]> {
    return this.handovers.findMany(dateOf(businessDate));
  }
}

/** Day Close and Month Close (§20, Period Lock). */
@Controller('day-close')
export class DayCloseController {
  constructor(private readonly dayClose: DayCloseService) {}

  /** Everyone may look: the list is what tells a seller what to finish. */
  @Get('pre-check')
  preCheck(@Query('business_date') businessDate?: string) {
    return this.dayClose.preCheck(dateOf(businessDate));
  }

  @Roles(user_role.OWNER)
  @Post('close')
  close(
    @Body() dto: CloseDayDto,
    @Query('business_date') businessDate: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<business_days> {
    return this.dayClose.closeDay(dateOf(businessDate), dto.pin, user, request.ip);
  }
}

@Roles(user_role.OWNER)
@Controller('month-close')
export class MonthCloseController {
  constructor(private readonly dayClose: DayCloseService) {}

  @Get(':year/:month')
  preCheck(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.dayClose.monthPreCheck(year, month);
  }

  @Post(':year/:month/close')
  close(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: CloseMonthDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<business_months> {
    return this.dayClose.closeMonth(year, month, dto.pin, user, request.ip);
  }

  /** Period Reopen — the exception, never the daily fix (§27.1). */
  @Post(':year/:month/reopen')
  reopen(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: ReopenMonthDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<business_months> {
    return this.dayClose.reopenMonth(
      year,
      month,
      dto.reason,
      dto.pin,
      user,
      request.ip,
    );
  }
}
