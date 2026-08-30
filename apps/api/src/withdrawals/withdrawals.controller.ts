import { Body, Controller, Post } from '@nestjs/common';
import { documents, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateWithdrawalDto } from './dto/withdrawal.dto';
import { WithdrawalsService } from './withdrawals.service';

/** Equity movements are the owner's alone (§2, §3.1). */
@Roles(user_role.OWNER)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  /** Creates a DRAFT. Money leaves on POST /api/documents/:id/confirm. */
  @Post()
  create(
    @Body() dto: CreateWithdrawalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.withdrawals.create(dto, user.id);
  }
}
