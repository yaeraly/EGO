import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import {
  Prisma,
  approval_status,
  debt_status,
  documents,
  user_role,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AdvancesService } from '../advances/advances.service';
import { ReservationsService } from '../reservations/reservations.service';
import { AuditService } from '../audit/audit.service';
import { BonusesService } from '../bonuses/bonuses.service';
import { AuthService } from '../auth/auth.service';
import { roundMoney } from '../common/decimal';
import { CreditService } from '../credit/credit.service';
import { CustomersService } from '../customers/customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { discountFacts, lossAmount, saleBlocks, PricedLine } from './sale-rules';
import { SaleFull, SalesRepository } from './sales.repository';

const ZERO = new Prisma.Decimal(0);

/** What a sale confirmation was told before it started. */
export interface ConfirmContext {
  pin?: string;
  creditOverrideReason?: string;
  role: user_role;
  /** Carried through so the Security Log records where the PIN came from. */
  ip?: string | null;
  device?: string | null;
}

/**
 * The context a confirm needs, carried between the controller and the poster.
 *
 * `DocumentsService.confirm` posts by document type and knows nothing about
 * PINs or overrides, so the sale's own controller stores what it was given
 * here for the poster to pick up in the same request.
 */
@Injectable()
export class SaleConfirmContextHolder {
  private readonly contexts = new Map<string, ConfirmContext>();

  set(saleId: string, context: ConfirmContext): void {
    this.contexts.set(saleId, context);
  }

  take(saleId: string): ConfirmContext | undefined {
    const context = this.contexts.get(saleId);
    this.contexts.delete(saleId);
    return context;
  }
}

/**
 * Confirming a sale — stock out, money in, debt recorded, all at once.
 *
 * The order is the safety: the price rules are checked against the cost of
 * the very units about to leave, credit is decided with the customer's debts
 * locked, and only then does anything move. If any part fails the whole
 * transaction does, so a sale never half-happens.
 */
@Injectable()
export class SaleConfirmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SalesRepository,
    private readonly customers: CustomersService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly accounts: AccountsService,
    private readonly credit: CreditService,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly context: SaleConfirmContextHolder,
    // forwardRef: advances settle debts through SalesRepository (§35.4) while
    // a sale spends advances (§17-А.2) — the two modules refer to each other.
    @Inject(forwardRef(() => AdvancesService))
    private readonly advances: AdvancesService,
    private readonly reservations: ReservationsService,
    private readonly bonuses: BonusesService,
  ) {}

  async confirm(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const context: ConfirmContext = this.context.take(document.id) ?? {
      role: user_role.SALES_MANAGER,
    };

    const locked = await this.repository.lock(tx, document.id);
    if (!locked) {
      throw new NotFoundException(`Sale body missing for ${document.doc_number}`);
    }

    const sale = await this.require(tx, document.id);
    if (sale.sale_items.length === 0) {
      throw new BadRequestException(
        `${document.doc_number} has no lines; add at least one before confirming`,
      );
    }

    const warehouse = await this.warehouses.main();

    // 1. §13.3 — cost the exact units, from the layers about to be consumed.
    const lines = await this.priceLines(tx, sale, warehouse.id);
    const facts = discountFacts(lines);

    // 2. §13.1–13.5 — the price rules, including the one nobody overrides.
    const salesperson = await tx.users.findUnique({
      where: { id: sale.salesperson },
      select: { max_discount_pct: true, role: true },
    });
    const blocks = saleBlocks({
      lines,
      maxDiscountPct: salesperson?.max_discount_pct ?? ZERO,
      // §13.5 makes the OWNER the approver; their own discount needs no
      // second signature. §13.4 still refuses everyone.
      discountApproved:
        sale.approval_status === approval_status.APPROVED ||
        salesperson?.role === user_role.OWNER,
      isLossSale: sale.is_loss_sale,
    });
    if (blocks.length > 0) {
      // 422: the request is well formed, the sale is not permitted.
      throw new UnprocessableEntityException({
        message: 'Сатууну тастыктоого болбойт (§13)',
        blocks,
      });
    }

    // 3. §15 — what was paid, and what change was handed back.
    const paid = sale.sale_payment_lines.reduce(
      (sum, line) => sum.plus(line.amount),
      ZERO,
    );
    const change = sale.sale_payment_lines.reduce(
      (sum, line) => sum.plus(line.change_given ?? ZERO),
      ZERO,
    );
    if (paid.greaterThan(facts.finalTotal)) {
      throw new ConflictException(
        `Төлөм ${paid.toFixed(2)} сатуу суммасынан ашык (§15.1)`,
      );
    }
    // §17-А.2: money the customer already gave us is not a debt and is not a
    // second payment. It comes off before credit is weighed, so an advance
    // that covers the sale never trips a credit limit (§17-А.3).
    const advance = await this.advances.applyToSale(tx, {
      customerId: sale.customer_id,
      saleId: sale.document_id,
      upTo: facts.finalTotal.minus(paid),
    });

    const outstanding = facts.finalTotal.minus(paid).minus(advance.applied);

    // 4. Security — the PIN, only when the sale departs from the fast path.
    await this.verifyPin(sale, context, {
      total: facts.finalTotal,
      outstanding,
      hasManualDiscount: facts.hasManualDiscount,
    });

    // 5. §16 — the debt, its due date, and whether it is allowed at all.
    if (outstanding.greaterThan(0)) {
      // Walk-in is refused by the credit decision itself (§11.1.2), so every
      // reason a debt is not allowed arrives on one path with one shape.
      if (!sale.customers.is_walk_in && !sale.debt_due_date) {
        throw new BadRequestException(
          'Карызга сатууда төлөө мөөнөтү милдеттүү (§16)',
        );
      }

      const decision = await this.credit.decide(tx, {
        customer: sale.customers,
        newDebt: outstanding,
      });

      if (!decision.allowed) {
        // §16.5 — only the OWNER passes, only with a reason, and only for the
        // blocks §16.5 names. Walk-in is not one of them (§11.1.2).
        const overridable =
          decision.reason === 'OVERDUE' || decision.reason === 'LIMIT_EXCEEDED';
        if (!overridable || !context.creditOverrideReason) {
          throw new UnprocessableEntityException({
            message: decision.message,
            code: decision.reason,
            credit: {
              current_open_debt: decision.current_open_debt.toFixed(2),
              overdue_amount: decision.overdue_amount.toFixed(2),
              effective_credit_limit:
                decision.effective_credit_limit?.toFixed(2) ?? null,
              new_debt: decision.new_debt.toFixed(2),
              projected_debt: decision.projected_debt.toFixed(2),
              must_pay_now: decision.must_pay_now.toFixed(2),
            },
          });
        }

        await this.credit.recordOverride(tx, {
          decision,
          customerId: sale.customer_id,
          saleId: sale.document_id,
          ownerId: userId,
          role: context.role,
          reason: context.creditOverrideReason,
        });
      }
    }

    // 6. §18.1.4 — stock out, and the allocation that records where from.
    let totalCogs = ZERO;
    for (const item of sale.sale_items) {
      // §42.2 — goods promised to someone else are not available here. The
      // sale's own reservation is excluded: fulfilling a hold must not be
      // blocked by the hold itself (§17).
      await this.stock.assertNotReserved(tx, {
        productId: item.product_id,
        sku: item.products.sku,
        warehouseId: warehouse.id,
        qty: item.qty,
        fulfilsReservationId: sale.from_reservation ?? undefined,
      });

      const plan = await this.stock.consumeFifo(tx, {
        productId: item.product_id,
        warehouseId: warehouse.id,
        qty: item.qty,
        documentId: document.id,
      });

      for (const allocation of plan.lines) {
        await this.repository.insertLayerAllocation(tx, {
          saleItemId: item.id,
          layerId: allocation.layerId,
          qty: allocation.qty,
          unitCost: allocation.unitCost,
        });
      }
      await this.repository.setItemCogs(tx, item.id, plan.cogs);
      totalCogs = totalCogs.plus(plan.cogs);
    }

    // 7. §15, §19 — money into each salesperson's own account, net of change.
    for (const line of sale.sale_payment_lines) {
      const { account, balance } = await this.accounts.lockBalance(
        tx,
        line.account_id,
      );
      await this.accounts.postMovement(tx, {
        accountId: line.account_id,
        documentId: document.id,
        amount: line.amount,
        kgsValue: null,
        currentBalance: balance,
        accountName: account.name,
      });
    }

    await this.repository.setTotals(tx, document.id, {
      totalAmount: facts.finalTotal,
      totalCogs,
      paidAmount: paid,
      outstandingAmount: outstanding,
      debtDueDate: sale.debt_due_date,
      debtStatus: outstanding.isZero()
        ? debt_status.CLOSED
        : paid.greaterThan(0)
          ? debt_status.PARTIALLY_PAID
          : debt_status.OPEN,
    });

    // §23.1 — the margin is known the moment the sale is confirmed, so the
    // bonus is recorded now. Whether it is payable is a separate question
    // (§23.2), answered by whether this sale is settled.
    await this.bonuses.calculateForSale(tx, {
      saleId: document.id,
      salesperson: sale.salesperson,
      revenue: facts.finalTotal,
      fifoCogs: totalCogs,
      outstanding,
      isLossSale: sale.is_loss_sale,
    });

    // §17 — the hold has done its job; the goods have left. Marking it here
    // rather than on a schedule keeps the reservation and the sale one fact.
    if (sale.from_reservation) {
      await this.reservations.markFulfilled(
        tx,
        sale.from_reservation,
        document.id,
      );
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'sales',
        entityId: document.id,
        action: sale.is_loss_sale ? 'LOSS_SALE_CONFIRMED' : 'SALE_CONFIRMED',
        newValue: {
          customer_id: sale.customer_id,
          is_walk_in: sale.customers.is_walk_in,
          total_amount: facts.finalTotal.toFixed(2),
          auto_total: facts.autoTotal.toFixed(2),
          discount_amount: facts.discountAmount.toFixed(2),
          discount_pct: facts.discountPct.toFixed(2),
          fifo_cogs: totalCogs.toFixed(2),
          margin: facts.finalTotal.minus(totalCogs).toFixed(2),
          paid_amount: paid.toFixed(2),
          change_given: change.toFixed(2),
          outstanding_amount: outstanding.toFixed(2),
          advance_applied: advance.applied.toFixed(2),
          from_reservation: sale.from_reservation,
          debt_due_date: sale.debt_due_date?.toISOString().slice(0, 10) ?? null,
          // §13.6 — a loss sale records what it cost the business, and its
          // bonus base is zero rather than negative.
          loss_amount: sale.is_loss_sale
            ? lossAmount({ ...facts, fifoCogs: totalCogs }).toFixed(2)
            : null,
          bonus_base: sale.is_loss_sale
            ? '0.00'
            : facts.finalTotal.minus(totalCogs).toFixed(2),
          approval_status: sale.approval_status,
          credit_override: context.creditOverrideReason ?? null,
        },
      },
      tx,
    );
  }

  /**
   * Whether a PIN is needed, and why (Security).
   *
   * The ordinary sale — no discount, paid in full, under the threshold — asks
   * for nothing, because §1 wants the counter fast. Anything that costs the
   * business money if it is wrong asks.
   */
  async pinRequirement(params: {
    total: Prisma.Decimal;
    outstanding: Prisma.Decimal;
    hasManualDiscount: boolean;
  }): Promise<{ required: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    if (params.hasManualDiscount) {
      reasons.push('кол менен скидка берилди');
    }
    if (params.outstanding.greaterThan(0)) {
      reasons.push('карызга сатуу');
    }

    const threshold = await this.settings.optionalDecimal(
      SettingKey.SALE_PIN_THRESHOLD_KGS,
    );
    if (threshold && params.total.greaterThanOrEqualTo(threshold)) {
      reasons.push(`сумма ${threshold.toFixed(2)} сомдон жогору`);
    }

    return { required: reasons.length > 0, reasons };
  }

  /** Whether this role sees the cost figure on the screen (§13.4). */
  async maySeeCogs(role: user_role): Promise<boolean> {
    if (role === user_role.OWNER) {
      return true;
    }
    const setting = await this.settings
      .findOne(SettingKey.SHOW_COGS_TO_STAFF)
      .catch(() => null);
    return setting?.value === true;
  }

  private async verifyPin(
    sale: SaleFull,
    context: ConfirmContext,
    facts: {
      total: Prisma.Decimal;
      outstanding: Prisma.Decimal;
      hasManualDiscount: boolean;
    },
  ): Promise<void> {
    const requirement = await this.pinRequirement(facts);
    if (!requirement.required) {
      return;
    }
    if (!context.pin) {
      throw new UnprocessableEntityException({
        message: `Бул сатуу PIN талап кылат: ${requirement.reasons.join(', ')}`,
        code: 'PIN_REQUIRED',
        pin_reasons: requirement.reasons,
      });
    }

    // `verifyPin` reports a wrong PIN rather than throwing, and logs both
    // outcomes to the Security Log either way.
    const { valid } = await this.auth.verifyPin(sale.salesperson, context.pin, {
      ip: context.ip ?? null,
      device: context.device ?? `sale:${sale.document_id}`,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }
  }

  private async priceLines(
    db: Prisma.TransactionClient,
    sale: SaleFull,
    warehouseId: string,
  ): Promise<PricedLine[]> {
    const lines: PricedLine[] = [];
    for (const item of sale.sale_items) {
      const plan = await this.stock.simulateFifo(db, {
        productId: item.product_id,
        warehouseId,
        qty: item.qty,
      });
      lines.push({
        productId: item.product_id,
        sku: item.products.sku,
        name: item.products.name,
        qty: item.qty,
        autoPrice: item.auto_price,
        finalPrice: item.final_price,
        minSellingPrice: item.products.min_selling_price,
        fifoCogs: plan.cogs,
        discountReason: item.discount_reason,
      });
    }
    return lines;
  }

  private async require(
    db: Prisma.TransactionClient,
    saleId: string,
  ): Promise<SaleFull> {
    const sale = await this.repository.findById(db, saleId);
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    return sale;
  }
}

export { roundMoney };
