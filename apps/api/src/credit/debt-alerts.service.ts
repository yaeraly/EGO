import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { BUSINESS_TIMEZONE, bishkekDateKey } from '../documents/document-number';
import { NotificationKind } from '../notifications/notification-kinds';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { CreditService, startOfToday } from './credit.service';

const ZERO = new Prisma.Decimal(0);

export interface DebtAlertRun {
  date: string;
  overdue: { customers: number; total: string; raised: number };
  due_soon: { warning_days: number; debts: number; raised: number };
}

/**
 * The nightly debt sweep (§16, §16.4, §39).
 *
 * Two things go out: a debt that has passed its due date, which also blocks
 * that customer from buying on credit until it is settled (§16.4); and a debt
 * falling due soon, which §16 says warns both the salesperson responsible and
 * the OWNER while there is still time to collect.
 */
@Injectable()
export class DebtAlertsService {
  private readonly logger = new Logger(DebtAlertsService.name);

  constructor(
    private readonly credit: CreditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** 08:00 Bishkek, before the shop opens. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, {
    name: 'customer-debt-alerts',
    timeZone: BUSINESS_TIMEZONE,
  })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run();
      this.logger.log(
        `Debt alerts for ${result.date}: ${result.overdue.customers} overdue, ${result.due_soon.debts} due soon`,
      );
    } catch (error) {
      this.logger.error('Debt alerts failed', error as Error);
    }
  }

  async run(now: Date = new Date()): Promise<DebtAlertRun> {
    const date = bishkekDateKey(now);
    const today = startOfToday(now);

    return {
      date,
      overdue: await this.overdue(date, today),
      due_soon: await this.dueSoon(date, today),
    };
  }

  /** Debts past their date (§16.4). One digest, so the OWNER sees the shape. */
  private async overdue(
    date: string,
    today: Date,
  ): Promise<DebtAlertRun['overdue']> {
    const debts = await this.credit.overdueDebts(today);
    if (debts.length === 0) {
      return { customers: 0, total: ZERO.toFixed(2), raised: 0 };
    }

    const byCustomer = new Map<string, { name: string; total: Prisma.Decimal }>();
    let total = ZERO;
    for (const debt of debts) {
      const entry = byCustomer.get(debt.customers.id) ?? {
        name: debt.customers.name,
        total: ZERO,
      };
      entry.total = entry.total.plus(debt.outstanding_amount);
      byCustomer.set(debt.customers.id, entry);
      total = total.plus(debt.outstanding_amount);
    }

    const raised = await this.notifications.notifyOwners({
      kind: NotificationKind.CUSTOMER_DEBT_OVERDUE,
      title: `Мөөнөтү өткөн карыз: ${total.toFixed(2)} сом`,
      body: [...byCustomer.values()]
        .map((entry) => `${entry.name}: ${entry.total.toFixed(2)} сом`)
        .join('\n'),
      payload: {
        date,
        total: total.toFixed(2),
        customers: [...byCustomer.entries()].map(([id, entry]) => ({
          customer_id: id,
          name: entry.name,
          overdue: entry.total.toFixed(2),
        })),
      },
      dedupeKey: `${NotificationKind.CUSTOMER_DEBT_OVERDUE}:${date}`,
    });

    return { customers: byCustomer.size, total: total.toFixed(2), raised };
  }

  /**
   * Debts about to fall due (§16).
   *
   * Sent to the salesperson who made the sale as well as the OWNER, because
   * §16 names them both and the salesperson is who the customer knows.
   */
  private async dueSoon(
    date: string,
    today: Date,
  ): Promise<DebtAlertRun['due_soon']> {
    const days =
      (await this.settings.optionalDecimal(SettingKey.DEBT_DUE_WARNING_DAYS))
        ?.toNumber() ?? 3;

    const until = new Date(today);
    until.setUTCDate(until.getUTCDate() + days);

    const debts = await this.credit.dueSoon(today, until);
    if (debts.length === 0) {
      return { warning_days: days, debts: 0, raised: 0 };
    }

    let raised = 0;
    for (const debt of debts) {
      const due = debt.debt_due_date!.toISOString().slice(0, 10);
      const title = `Карыздын мөөнөтү жакындады: ${debt.customers.name}`;
      const body =
        `${debt.documents_sales_document_idTodocuments.doc_number} — ` +
        `${debt.outstanding_amount.toFixed(2)} сом, мөөнөтү ${due}`;
      const payload = {
        date,
        sale_id: debt.document_id,
        customer_id: debt.customers.id,
        outstanding: debt.outstanding_amount.toFixed(2),
        due_date: due,
      };
      const dedupeKey = `${NotificationKind.CUSTOMER_DEBT_DUE_SOON}:${debt.document_id}:${date}`;

      raised += await this.notifications.notifyOwners({
        kind: NotificationKind.CUSTOMER_DEBT_DUE_SOON,
        title,
        body,
        payload,
        dedupeKey,
      });

      // The responsible salesperson too (§16), unless they are the OWNER and
      // already have it.
      if (
        await this.notifications.notify({
          userId: debt.users_sales_salespersonTousers.id,
          kind: NotificationKind.CUSTOMER_DEBT_DUE_SOON,
          title,
          body,
          payload,
          dedupeKey,
        })
      ) {
        raised += 1;
      }
    }

    return { warning_days: days, debts: debts.length, raised };
  }
}
