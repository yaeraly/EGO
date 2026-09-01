import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { user_role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpsertPlanDto } from './dto/plan.dto';
import { PlanView, PlansService } from './plans.service';

/** Plans and KPI (§24). The OWNER's to set — §24 says so in its first line. */
@Roles(user_role.OWNER)
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Put()
  upsert(
    @Body() dto: UpsertPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlanView> {
    return this.plans.upsert(dto, user.id);
  }

  @Get()
  findMany(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<PlanView[]> {
    return this.plans.findMany({
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
    });
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ removed: true }> {
    await this.plans.remove(id, user.id);
    return { removed: true };
  }
}
