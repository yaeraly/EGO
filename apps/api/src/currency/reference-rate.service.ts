import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, currency_code } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';

export type RateSource = 'FACTUAL' | 'REFERENCE' | 'MANUAL';

export interface ReferenceRate {
  rate: Prisma.Decimal;
  /**
   * REFERENCE — the last real currency purchase; MANUAL — the OWNER's
   * cold-start value. §10.1 requires the source to be recorded alongside the
   * rate, and it goes into the Audit Log where the rate is used.
   */
  source: Exclude<RateSource, 'FACTUAL'>;
}

const MANUAL_KEYS: Partial<Record<currency_code, string>> = {
  [currency_code.CNY]: SettingKey.MANUAL_REFERENCE_RATE_CNY,
  [currency_code.USD]: SettingKey.MANUAL_REFERENCE_RATE_USD,
};

/**
 * Reference rate for currency that has not been paid for yet (§10.1, rule 2).
 *
 * "акыркы реалдуу валюта сатып алуу курсу" — the rate of the most recent CEX
 * purchase, which is exactly the newest FIFO layer's rate. Until the business
 * has bought that currency even once there is no such rate, and §10.1 lets the
 * OWNER supply one by hand; that lives in settings, where the change is
 * already audited.
 */
@Injectable()
export class ReferenceRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async forCurrency(currency: currency_code): Promise<ReferenceRate> {
    const latest = await this.prisma.currency_layers.findFirst({
      where: { payment_accounts: { currency } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { rate_kgs: true },
    });

    if (latest) {
      return { rate: latest.rate_kgs, source: 'REFERENCE' };
    }

    const manualKey = MANUAL_KEYS[currency];
    const manual = manualKey
      ? await this.settings.optionalDecimal(manualKey as never)
      : null;

    if (manual && manual.greaterThan(0)) {
      return { rate: manual, source: 'MANUAL' };
    }

    throw new ConflictException(
      `No ${currency} reference rate: buy ${currency} first (CEX), or set ${manualKey} (§10.1)`,
    );
  }
}
