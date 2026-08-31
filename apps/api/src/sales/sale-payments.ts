import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, account_type, payment_accounts } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

export interface ResolvedPaymentLine {
  account: payment_accounts;
  /** What lands in the account — net of change, for cash (§15.2). */
  amount: Prisma.Decimal;
  cashGiven: Prisma.Decimal | null;
  changeGiven: Prisma.Decimal | null;
}

export interface PaymentPlan {
  lines: ResolvedPaymentLine[];
  /** Σ amounts — what the customer has actually paid towards the sale. */
  paid: Prisma.Decimal;
  /** Total change handed back, all of it from cash (§15.2). */
  change: Prisma.Decimal;
}

/**
 * Works out what each payment line does to which account (§15).
 *
 * A sale may be paid across several channels at once, and cash may be given
 * over the amount due — in which case the difference is change, and the till
 * gains only the net (§15.2's own example: 10 000 given on an 8 000 sale
 * leaves 8 000 in the till, not 10 000).
 *
 * Change comes out of cash and nothing else: §15.2 forbids "change" from a
 * bank or wallet account, because there is no cash there to hand over.
 *
 * Pure, so the arithmetic can be checked without a database.
 */
export function resolvePayments(params: {
  lines: {
    account: payment_accounts;
    amount: Prisma.Decimal;
    cashGiven: Prisma.Decimal | null;
  }[];
  total: Prisma.Decimal;
  /** Whose sale this is — §19 puts the money in their own account. */
  salespersonId: string;
}): PaymentPlan {
  const resolved: ResolvedPaymentLine[] = [];
  let paid = ZERO;
  let change = ZERO;

  for (const line of params.lines) {
    if (line.amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        `${line.account.name}: төлөм суммасы нөлдөн чоң болушу керек`,
      );
    }
    if (!line.account.is_active) {
      throw new BadRequestException(`${line.account.name} эсеби активдүү эмес`);
    }
    if (line.account.currency !== 'KGS') {
      throw new BadRequestException(
        `${line.account.name} ${line.account.currency} эсеби — сатуу сом менен төлөнөт`,
      );
    }
    // §19: each salesperson has their own accounts, and a sale's money lands
    // in theirs. Posting into someone else's till would make that person's
    // day-close figures answer for money they never took.
    if (line.account.owner_user !== params.salespersonId) {
      throw new ConflictException(
        `${line.account.name} башка кызматкердин эсеби — сатуунун акчасы ` +
          'сатуучунун өз эсебине түшөт (§19)',
      );
    }

    let lineChange: Prisma.Decimal | null = null;
    if (line.cashGiven !== null) {
      if (line.account.type !== account_type.CASH) {
        throw new ConflictException(
          `Сдача Cash эсебинен гана берилет — ${line.account.name} ` +
            `${line.account.type} эсеби (§15.2)`,
        );
      }
      if (line.cashGiven.lessThan(line.amount)) {
        throw new BadRequestException(
          `${line.account.name}: берилген накталай ${line.cashGiven.toFixed(2)} ` +
            `сатуу суммасынан (${line.amount.toFixed(2)}) аз`,
        );
      }
      lineChange = line.cashGiven.minus(line.amount);
      change = change.plus(lineChange);
    }

    resolved.push({
      account: line.account,
      amount: line.amount,
      cashGiven: line.cashGiven,
      changeGiven: lineChange,
    });
    paid = paid.plus(line.amount);
  }

  if (paid.greaterThan(params.total)) {
    // Overpaying at the counter is change, not an advance: §16-А.5's advance
    // comes from a later PAY document, not from the sale itself.
    throw new ConflictException(
      `Төлөм ${paid.toFixed(2)} сатуу суммасынан (${params.total.toFixed(2)}) ашык — ` +
        'ашыгын сдача катары көрсөтүңүз (§15.1)',
    );
  }

  return { lines: resolved, paid, change };
}
