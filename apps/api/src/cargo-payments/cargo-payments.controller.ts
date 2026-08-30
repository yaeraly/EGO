import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { cargo_ledger, documents, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { money, requiredMoney } from '../common/money-json';
import { CargoCompaniesService } from '../counterparties/counterparties.service';
import { CargoLedgerService } from '../ledgers/ledgers.service';
import { CargoPaymentsService } from './cargo-payments.service';
import { CreateCargoPaymentDto } from './dto/cargo-payment.dto';

/** One ledger row, with its money rendered at full scale. */
export type CargoLedgerEntryView = Omit<
  cargo_ledger,
  'amount_usd' | 'kgs_value'
> & { amount_usd: string; kgs_value: string | null };

@Roles(user_role.OWNER)
@Controller()
export class CargoPaymentsController {
  constructor(
    private readonly payments: CargoPaymentsService,
    private readonly ledger: CargoLedgerService,
    private readonly companies: CargoCompaniesService,
  ) {}

  /** Creates a DRAFT. Money moves on POST /api/documents/:id/confirm. */
  @Post('cargo-payments')
  create(
    @Body() dto: CreateCargoPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.payments.create(dto, user.id);
  }

  /**
   * The carrier's ledger and balance, in USD (§5.2).
   *
   * A positive balance is a deposit we are holding with them — normal in
   * Module 2, where freight cost is not recognised until Receipt.
   */
  @Get('cargo-companies/:id/ledger')
  async cargoLedger(@Param('id', ParseUUIDPipe) id: string): Promise<{
    cargo_company_id: string;
    balance_usd: string;
    we_owe_usd: string;
    on_deposit_usd: string;
    entries: CargoLedgerEntryView[];
  }> {
    await this.companies.findOne(id);
    const balance = await this.ledger.balance(id);
    const entries = await this.ledger.history(id);

    return {
      cargo_company_id: id,
      balance_usd: balance.toFixed(2),
      we_owe_usd: balance.isNegative() ? balance.negated().toFixed(2) : '0.00',
      on_deposit_usd: balance.greaterThan(0) ? balance.toFixed(2) : '0.00',
      entries: entries.map((entry) => ({
        ...entry,
        amount_usd: requiredMoney(entry.amount_usd),
        kgs_value: money(entry.kgs_value),
      })),
    };
  }
}
