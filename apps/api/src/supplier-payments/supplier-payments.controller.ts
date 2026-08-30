import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { documents, supplier_ledger, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { money, requiredMoney } from '../common/money-json';
import { SuppliersService } from '../counterparties/counterparties.service';
import { SupplierLedgerService } from '../ledgers/ledgers.service';
import { CreateSupplierPaymentDto } from './dto/supplier-payment.dto';
import { SupplierPaymentsService } from './supplier-payments.service';

/** One ledger row, with its money rendered at full scale. */
export type SupplierLedgerEntryView = Omit<
  supplier_ledger,
  'amount_cny' | 'kgs_value'
> & { amount_cny: string; kgs_value: string | null };

/** Paying suppliers is the OWNER's (§2: capital and settlements). */
@Roles(user_role.OWNER)
@Controller()
export class SupplierPaymentsController {
  constructor(
    private readonly payments: SupplierPaymentsService,
    private readonly ledger: SupplierLedgerService,
    private readonly suppliers: SuppliersService,
  ) {}

  /** Creates a DRAFT. Money moves on POST /api/documents/:id/confirm. */
  @Post('supplier-payments')
  create(
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.payments.create(dto, user.id);
  }

  /**
   * The supplier's ledger and balance (§4.2).
   *
   * Negative means we owe; positive means they do — an advance or a
   * receivable. The debt itself is in CNY (§4.2); a KGS figure would be a
   * different number tomorrow.
   */
  @Get('suppliers/:id/ledger')
  async supplierLedger(@Param('id', ParseUUIDPipe) id: string): Promise<{
    supplier_id: string;
    balance_cny: string;
    we_owe_cny: string;
    entries: SupplierLedgerEntryView[];
  }> {
    await this.suppliers.findOne(id);
    const balance = await this.ledger.balance(id);
    const entries = await this.ledger.history(id);

    return {
      supplier_id: id,
      balance_cny: balance.toFixed(2),
      we_owe_cny: balance.isNegative() ? balance.negated().toFixed(2) : '0.00',
      entries: entries.map((entry) => ({
        ...entry,
        amount_cny: requiredMoney(entry.amount_cny),
        kgs_value: money(entry.kgs_value),
      })),
    };
  }
}
