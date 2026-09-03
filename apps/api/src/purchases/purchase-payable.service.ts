import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, currency_code } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ReferenceRateService } from '../currency/reference-rate.service';
import { SupplierLedgerService } from '../ledgers/ledgers.service';
import { PAYABLE_STAGE } from './payable-recognition';
import { PurchasesRepository } from './purchases.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * What we owe the supplier for one order, and when (§4.2, §6.1).
 *
 * The order itself commits nobody: the partner still has to gather the parts,
 * and either side can walk away. The money falls due when the goods leave
 * their warehouse — from that moment we owe for them and they owe us the
 * shipment.
 *
 * It lives apart from `PurchasesService` because two places reach that
 * moment: the logistics stage moving to `LEFT_SUPPLIER` (or past it), and a
 * Receipt, since goods cannot be received without having been shipped.
 */
@Injectable()
export class PurchasePayableService {
  constructor(
    private readonly repository: PurchasesRepository,
    private readonly referenceRate: ReferenceRateService,
    private readonly ledger: SupplierLedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Recognises the debt for the goods, once.
   *
   * Recognised once and never withdrawn: a stage set by mistake and moved
   * back leaves the debt standing, because a debt that comes and goes with a
   * dropdown is not a debt. Undoing it is what a correction is for (§27.1).
   *
   * The amount is the order total in CNY — the debt itself is a yuan debt.
   * Its KGS value is booked at the reference rate (§10.1) so a later payment
   * has something to measure gain or loss against; the rate and its source go
   * into the Audit Log, as §10.1 requires. If the goods arrive short, §8.3
   * reduces this rather than rewriting it.
   */
  async recognise(
    tx: Prisma.TransactionClient,
    documentId: string,
    userId: string,
    reason: 'STAGE' | 'RECEIPT' = 'STAGE',
  ): Promise<void> {
    if (await this.ledger.hasPayable(tx, documentId)) {
      return;
    }

    const purchase = await this.repository.findById(tx, documentId);
    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    const total = purchase.purchase_items.reduce(
      (sum, item) => sum.plus(item.qty.times(item.price_cny)),
      ZERO,
    );
    const reference = await this.referenceRate.forCurrency(currency_code.CNY);

    await this.ledger.recordPayable(tx, {
      supplierId: purchase.supplier_id,
      documentId,
      amountCny: total,
      rateKgs: reference.rate,
    });

    await this.audit.log(
      {
        userId,
        documentId,
        entity: 'purchases',
        entityId: documentId,
        action: 'PURCHASE_PAYABLE_RECOGNISED',
        newValue: {
          supplier_id: purchase.supplier_id,
          due_at: reason === 'RECEIPT' ? 'RECEIPT' : PAYABLE_STAGE,
          total_cny: total.toFixed(2),
          reference_rate: reference.rate.toString(),
          reference_rate_source: reference.source,
          payable_kgs: total.times(reference.rate).toFixed(2),
        },
      },
      tx,
    );
  }
}
