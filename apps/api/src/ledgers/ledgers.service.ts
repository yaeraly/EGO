import { Injectable } from '@nestjs/common';
import { Prisma, cargo_ledger, supplier_ledger } from '@prisma/client';
import { Db } from '../common/db';
import { roundMoney } from '../common/decimal';
import { PrismaService } from '../prisma/prisma.service';
import {
  CARGO_DEBT_ENTRIES,
  CargoEntry,
  SUPPLIER_DEBT_ENTRIES,
  SUPPLIER_PREPAY_ENTRIES,
  SupplierEntry,
} from './ledger-entry-types';
import {
  CargoLedgerRepository,
  OpenBalance,
  SupplierLedgerRepository,
} from './ledgers.repository';

const ZERO = new Prisma.Decimal(0);

/** How a payment divides between closing debt and becoming an advance. */
export interface DebtSplit {
  /** The part that closes open debt (§4.3). */
  debtPart: Prisma.Decimal;
  /** The part beyond the debt, which becomes a prepayment (§4.3). */
  prepayPart: Prisma.Decimal;
  /** KGS the debt part was recognised at, at the debt's own rate. */
  debtRecognisedKgs: Prisma.Decimal;
}

/**
 * Splits a payment against an open balance.
 *
 * §4.3: the part that covers debt reduces it, and the excess becomes an
 * advance — a payable never goes negative. The recognised KGS value of the
 * debt part is carried at the *debt's* rate, not the payment's; the gap
 * between the two is exactly the FX gain or loss (§10.2).
 */
export function splitAgainstDebt(
  payment: Prisma.Decimal,
  open: OpenBalance,
): DebtSplit {
  const openAmount = Prisma.Decimal.max(open.amount, ZERO);
  const debtPart = Prisma.Decimal.min(payment, openAmount);
  const prepayPart = payment.minus(debtPart);

  // Proportional share of the recognised value, so a partial payment carries
  // its share of the rate rather than all of it.
  const debtRecognisedKgs = openAmount.isZero()
    ? ZERO
    : roundMoney(open.kgsValue.times(debtPart).dividedBy(openAmount));

  return { debtPart, prepayPart, debtRecognisedKgs };
}

@Injectable()
export class SupplierLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SupplierLedgerRepository,
  ) {}

  /** Whether this purchase's payable has already been recognised (§6.1). */
  hasPayable(tx: Db, documentId: string): Promise<boolean> {
    return this.repository.hasEntry(tx, documentId, SupplierEntry.PAYABLE);
  }

  /**
   * Recognises what we owe for goods that have left the supplier (§4.2, §6.1).
   *
   * The amount is the order total in CNY; the KGS value is that total at the
   * reference rate (§10.1), and it is what a later payment's gain or loss is
   * measured against. If the goods arrive short, Module 3 reduces this per
   * §8.3 rather than rewriting it.
   */
  async recordPayable(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      documentId: string;
      amountCny: Prisma.Decimal;
      rateKgs: Prisma.Decimal;
    },
  ): Promise<void> {
    await this.repository.insert(tx, {
      supplierId: params.supplierId,
      documentId: params.documentId,
      entryType: SupplierEntry.PAYABLE,
      amountCny: params.amountCny.negated(),
      kgsValue: roundMoney(params.amountCny.times(params.rateKgs)).negated(),
    });
  }

  openDebt(tx: Db, supplierId: string): Promise<OpenBalance> {
    return this.repository.openDebt(tx, supplierId, SUPPLIER_DEBT_ENTRIES);
  }

  /**
   * Records what a payment did: the debt it closed and the advance it left.
   *
   * The PAYMENT entry releases the debt's *recognised* KGS value, not what the
   * currency actually cost — that keeps the ledger's amount and KGS columns
   * consistent (a fully paid supplier nets to zero on both). The difference
   * between the two is the FX result, and it belongs on the payment document.
   */
  async recordPayment(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      documentId: string;
      split: DebtSplit;
      /** Actual KGS cost of the prepayment part, from the currency FIFO. */
      prepayActualKgs: Prisma.Decimal;
    },
  ): Promise<void> {
    if (params.split.debtPart.greaterThan(0)) {
      await this.repository.insert(tx, {
        supplierId: params.supplierId,
        documentId: params.documentId,
        entryType: SupplierEntry.PAYMENT,
        amountCny: params.split.debtPart,
        kgsValue: params.split.debtRecognisedKgs,
      });
    }

    if (params.split.prepayPart.greaterThan(0)) {
      // An advance is an asset carried at what it actually cost us.
      await this.repository.insert(tx, {
        supplierId: params.supplierId,
        documentId: params.documentId,
        entryType: SupplierEntry.PREPAYMENT,
        amountCny: params.split.prepayPart,
        kgsValue: params.prepayActualKgs,
      });
    }
  }

  /**
   * The advance the supplier is holding for us (§4.3).
   *
   * Positive means they owe us goods or money; that is what a later Receipt
   * draws on. Debt and advances are tracked as separate streams, so this
   * cannot be read off the overall balance.
   */
  openPrepayment(tx: Db, supplierId: string): Promise<OpenBalance> {
    // Read in the ledger's own signs, not flipped: an advance is a positive
    // balance, the opposite of debt, so `openDebt`'s negation would invert it.
    return this.repository.streamBalance(tx, supplierId, SUPPLIER_PREPAY_ENTRIES);
  }

  /**
   * Uses an advance against a payable (§4.3, second half).
   *
   * Two entries, because two things are true at once: the advance is spent
   * (PREPAYMENT_APPLY, negative) and the debt it settles is released. The
   * debt goes at the rate it was recognised at and the advance at what it
   * actually cost, so the gap between them is the exchange result (§10.2) —
   * the same arithmetic a cash payment does, with an advance in place of the
   * till.
   */
  async applyPrepayment(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      documentId: string;
      /** Yuan of advance being used. */
      amountCny: Prisma.Decimal;
      /** Its actual KGS cost, taken from the advance's own carried value. */
      actualKgs: Prisma.Decimal;
      /** What the debt it settles was recognised at (§10.1). */
      recognisedKgs: Prisma.Decimal;
    },
  ): Promise<void> {
    if (params.amountCny.lessThanOrEqualTo(0)) {
      return;
    }

    // Spending the advance: it leaves at what it cost us.
    await this.repository.insert(tx, {
      supplierId: params.supplierId,
      documentId: params.documentId,
      entryType: SupplierEntry.PREPAYMENT_APPLY,
      amountCny: params.amountCny.negated(),
      kgsValue: params.actualKgs.negated(),
    });

    // Settling the debt: it is released at what it was booked at, so a fully
    // settled supplier nets to zero on both columns.
    await this.repository.insert(tx, {
      supplierId: params.supplierId,
      documentId: params.documentId,
      entryType: SupplierEntry.PAYMENT,
      amountCny: params.amountCny,
      kgsValue: params.recognisedKgs,
    });
  }

  /**
   * Money already paid for goods that never arrived (§8.2).
   *
   * It is not a cost and it does not raise anyone's landed cost — it is a
   * claim on the supplier, held in CNY because that is the currency the debt
   * was in.
   */
  async recordReceivable(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      documentId: string;
      amountCny: Prisma.Decimal;
      kgsValue: Prisma.Decimal;
    },
  ): Promise<void> {
    await this.repository.insert(tx, {
      supplierId: params.supplierId,
      documentId: params.documentId,
      entryType: SupplierEntry.RECEIVABLE,
      amountCny: params.amountCny,
      kgsValue: params.kgsValue,
    });
  }

  /**
   * Reduces the payable for goods not yet paid for that never arrived (§8.3).
   *
   * No artificial receivable is invented here: we simply owe less. The entry
   * is a PAYMENT in the debt stream because it closes debt without money
   * moving, which is exactly what §8.3 describes.
   */
  async reducePayable(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      documentId: string;
      amountCny: Prisma.Decimal;
      kgsValue: Prisma.Decimal;
    },
  ): Promise<void> {
    await this.repository.insert(tx, {
      supplierId: params.supplierId,
      documentId: params.documentId,
      entryType: SupplierEntry.PAYMENT,
      amountCny: params.amountCny,
      kgsValue: params.kgsValue,
    });
  }

  balance(supplierId: string, db: Db = this.prisma): Promise<Prisma.Decimal> {
    return this.repository.balance(db, supplierId);
  }

  history(supplierId: string): Promise<supplier_ledger[]> {
    return this.repository.history(supplierId);
  }

  suppliersInDebt() {
    return this.repository.suppliersInDebt();
  }
}

@Injectable()
export class CargoLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CargoLedgerRepository,
  ) {}

  openDebt(tx: Db, cargoCompanyId: string): Promise<OpenBalance> {
    return this.repository.openDebt(tx, cargoCompanyId, CARGO_DEBT_ENTRIES);
  }

  /**
   * Records a cargo payment (§5.2).
   *
   * Until Receipt recognises the cargo cost (Module 3) there is nothing to
   * owe, so a payment made now simply leaves the balance positive — a deposit
   * with the carrier. Both parts are PAYMENT entries: the cargo ledger has no
   * separate advance concept, and a positive balance says the same thing.
   */
  async recordPayment(
    tx: Prisma.TransactionClient,
    params: {
      cargoCompanyId: string;
      documentId: string;
      split: DebtSplit;
      prepayActualKgs: Prisma.Decimal;
    },
  ): Promise<void> {
    if (params.split.debtPart.greaterThan(0)) {
      await this.repository.insert(tx, {
        cargoCompanyId: params.cargoCompanyId,
        documentId: params.documentId,
        entryType: CargoEntry.PAYMENT,
        amountUsd: params.split.debtPart,
        kgsValue: params.split.debtRecognisedKgs,
      });
    }

    if (params.split.prepayPart.greaterThan(0)) {
      await this.repository.insert(tx, {
        cargoCompanyId: params.cargoCompanyId,
        documentId: params.documentId,
        entryType: CargoEntry.PAYMENT,
        amountUsd: params.split.prepayPart,
        kgsValue: params.prepayActualKgs,
      });
    }
  }

  balance(
    cargoCompanyId: string,
    db: Db = this.prisma,
  ): Promise<Prisma.Decimal> {
    return this.repository.balance(db, cargoCompanyId);
  }

  history(cargoCompanyId: string): Promise<cargo_ledger[]> {
    return this.repository.history(cargoCompanyId);
  }

  companiesInDebt() {
    return this.repository.companiesInDebt();
  }
}
