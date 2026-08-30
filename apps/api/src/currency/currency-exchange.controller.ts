import { Body, Controller, Post } from '@nestjs/common';
import { documents, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrencyExchangeService } from './currency-exchange.service';
import { CreateCurrencyExchangeDto } from './dto/currency-exchange.dto';

/** OWNER only: §2 gives currency conversion to the owner. */
@Roles(user_role.OWNER)
@Controller('currency-exchanges')
export class CurrencyExchangeController {
  constructor(private readonly exchanges: CurrencyExchangeService) {}

  /** Creates a DRAFT. Money moves on POST /api/documents/:id/confirm. */
  @Post()
  create(
    @Body() dto: CreateCurrencyExchangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.exchanges.create(dto, user.id);
  }
}
