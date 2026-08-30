import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, currency_code } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { BUSINESS_TIMEZONE, bishkekDateKey } from '../documents/document-number';
import { CargoLedgerService, SupplierLedgerService } from '../ledgers/ledgers.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { NotificationKind } from './notification-kinds';
import { NotificationsService } from './notifications.service';

const ZERO = new Prisma.Decimal(0);

/** Which threshold governs which till (§39). Only foreign tills are watched. */
const LOW_BALANCE_THRESHOLDS = {
  [currency_code.CNY]: SettingKey.LOW_BALANCE_THRESHOLD_CNY,
  [currency_code.USD]: SettingKey.LOW_BALANCE_THRESHOLD_USD,
} as const;

export interface DigestResult {
  /** The Bishkek date the run is keyed to. */
  date: string;
  supplier_debt: { raised: boolean; suppliers: number; total_cny: string };
  cargo_debt: { raised: boolean; companies: number; total_usd: string };
  low_balance: {
    account_id: string;
    name: string;
    currency: currency_code;
    balance: string;
    threshold: string;
    raised: boolean;
  }[];
}

/**
 * The alerts §39 asks for that Module 2 can actually observe: supplier debt,
 * cargo debt, and a currency till running low.
 *
 * Everything here is derived at read time from the ledgers and account
 * movements — the digest raises no documents and changes no balances, so a
 * failed or repeated run costs nothing but a log line.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly cargoLedger: CargoLedgerService,
    private readonly accounts: AccountsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * 09:00 Bishkek, every day.
   *
   * The digest is keyed to the Bishkek date, so a restart, a second app
   * instance, or a manual re-run on the same day all collapse into the one
   * alert the OWNER already has.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, {
    name: 'daily-digest',
    timeZone: BUSINESS_TIMEZONE,
  })
  async scheduledDigest(): Promise<void> {
    try {
      const result = await this.runDailyDigest();
      this.logger.log(`Daily digest for ${result.date} complete`);
    } catch (error) {
      // A failed digest must never take the app down with it.
      this.logger.error('Daily digest failed', error as Error);
    }
  }

  async runDailyDigest(at: Date = new Date()): Promise<DigestResult> {
    const date = bishkekDateKey(at);

    return {
      date,
      supplier_debt: await this.supplierDebtDigest(date),
      cargo_debt: await this.cargoDebtDigest(date),
      low_balance: await this.lowCurrencyBalances(date),
    };
  }

  private async supplierDebtDigest(
    date: string,
  ): Promise<DigestResult['supplier_debt']> {
    const rows = await this.supplierLedger.suppliersInDebt();
    // The ledger carries debt as a negative balance; the alert states it owed.
    const total = rows
      .reduce((sum, row) => sum.plus(row.amount_cny), ZERO)
      .negated();

    if (rows.length === 0) {
      return { raised: false, suppliers: 0, total_cny: ZERO.toFixed(2) };
    }

    const lines = rows.map(
      (row) => `${row.name}: ${row.amount_cny.negated().toFixed(2)} CNY`,
    );

    const raised = await this.notifications.notifyOwners({
      kind: NotificationKind.SUPPLIER_DEBT,
      title: `Поставщик карызы: ${total.toFixed(2)} CNY`,
      body: lines.join('\n'),
      payload: {
        date,
        total_cny: total.toFixed(2),
        suppliers: rows.map((row) => ({
          supplier_id: row.supplier_id,
          name: row.name,
          amount_cny: row.amount_cny.negated().toFixed(2),
        })),
      },
      dedupeKey: `${NotificationKind.SUPPLIER_DEBT}:${date}`,
    });

    return {
      raised: raised > 0,
      suppliers: rows.length,
      total_cny: total.toFixed(2),
    };
  }

  private async cargoDebtDigest(
    date: string,
  ): Promise<DigestResult['cargo_debt']> {
    const rows = await this.cargoLedger.companiesInDebt();
    const total = rows
      .reduce((sum, row) => sum.plus(row.amount_usd), ZERO)
      .negated();

    if (rows.length === 0) {
      return { raised: false, companies: 0, total_usd: ZERO.toFixed(2) };
    }

    const lines = rows.map(
      (row) => `${row.name}: ${row.amount_usd.negated().toFixed(2)} USD`,
    );

    const raised = await this.notifications.notifyOwners({
      kind: NotificationKind.CARGO_DEBT,
      title: `Карго карызы: ${total.toFixed(2)} USD`,
      body: lines.join('\n'),
      payload: {
        date,
        total_usd: total.toFixed(2),
        cargo_companies: rows.map((row) => ({
          cargo_company_id: row.cargo_company_id,
          name: row.name,
          amount_usd: row.amount_usd.negated().toFixed(2),
        })),
      },
      dedupeKey: `${NotificationKind.CARGO_DEBT}:${date}`,
    });

    return {
      raised: raised > 0,
      companies: rows.length,
      total_usd: total.toFixed(2),
    };
  }

  /**
   * One alert per till that is below its threshold (§39).
   *
   * A threshold nobody has configured means "do not warn" — the setting is
   * seeded null on purpose, and inventing a default would either spam the
   * OWNER or, worse, stay quiet when they thought they had a warning.
   */
  private async lowCurrencyBalances(
    date: string,
  ): Promise<DigestResult['low_balance']> {
    const thresholds = new Map<currency_code, Prisma.Decimal | null>();
    for (const [currency, key] of Object.entries(LOW_BALANCE_THRESHOLDS)) {
      thresholds.set(
        currency as currency_code,
        await this.settings.optionalDecimal(key),
      );
    }

    const result: DigestResult['low_balance'] = [];

    for (const account of await this.accounts.balances()) {
      const threshold = thresholds.get(account.currency);
      if (!threshold) {
        continue;
      }

      const balance = new Prisma.Decimal(account.balance);
      if (balance.greaterThanOrEqualTo(threshold)) {
        continue;
      }

      const raised = await this.notifications.notifyOwners({
        kind: NotificationKind.LOW_CURRENCY_BALANCE,
        title: `Валюталык кассада баланс аз: ${account.name}`,
        body:
          `${account.name}: ${balance.toFixed(2)} ${account.currency} ` +
          `(порог ${threshold.toFixed(2)} ${account.currency}). ` +
          `Валюта сатып алуу керек (CEX).`,
        payload: {
          date,
          account_id: account.account_id,
          currency: account.currency,
          balance: balance.toFixed(2),
          threshold: threshold.toFixed(2),
        },
        dedupeKey: `${NotificationKind.LOW_CURRENCY_BALANCE}:${account.account_id}:${date}`,
      });

      result.push({
        account_id: account.account_id,
        name: account.name,
        currency: account.currency,
        balance: balance.toFixed(2),
        threshold: threshold.toFixed(2),
        raised: raised > 0,
      });
    }

    return result;
  }
}
