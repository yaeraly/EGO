import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { payment_accounts, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccountBalance, AccountsService } from './accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<payment_accounts> {
    return this.accounts.create(dto, user.id);
  }

  @Get()
  findAll(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<payment_accounts[]> {
    return this.accounts.findAll(includeInactive ?? false);
  }

  /** SUM(account_movements.amount) per account. */
  @Get('balances')
  balances(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<AccountBalance[]> {
    return this.accounts.balances(includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<payment_accounts> {
    return this.accounts.findOne(id);
  }

  @Get(':id/balance')
  async balance(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ account_id: string; balance: string }> {
    await this.accounts.findOne(id);
    const balance = await this.accounts.balance(id);
    return { account_id: id, balance: balance.toFixed(2) };
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<payment_accounts> {
    return this.accounts.update(id, dto, user.id);
  }
}
