import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, settings } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { SettingsRepository } from './settings.repository';
import { SettingKeyName } from './setting-keys';

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  findAll(): Promise<settings[]> {
    return this.repository.findAll();
  }

  async findOne(key: string): Promise<settings> {
    const setting = await this.repository.findByKey(key);
    if (!setting) {
      throw new NotFoundException(`Setting ${key} not found`);
    }
    return setting;
  }

  /** Creates or replaces a setting. */
  async put(
    key: string,
    value: Prisma.InputJsonValue | null,
    description: string | undefined,
    userId: string,
  ): Promise<settings> {
    const before = await this.repository.findByKey(key);
    const stored = value === null ? Prisma.JsonNull : value;

    const setting = await this.repository.upsert({
      key,
      value: stored,
      description: description ?? before?.description,
      userId,
    });

    await this.audit.log({
      userId,
      entity: 'settings',
      entityId: key,
      action: before ? 'SETTING_UPDATED' : 'SETTING_CREATED',
      oldValue: (before?.value as Prisma.InputJsonValue) ?? null,
      newValue: stored === Prisma.JsonNull ? null : (stored as Prisma.InputJsonValue),
    });

    return setting;
  }

  async remove(key: string, userId: string): Promise<void> {
    const before = await this.findOne(key);

    await this.repository.remove(key);

    await this.audit.log({
      userId,
      entity: 'settings',
      entityId: key,
      action: 'SETTING_DELETED',
      oldValue: before.value as Prisma.InputJsonValue,
    });
  }

  /**
   * Reads a configured numeric setting as a Decimal.
   *
   * A key seeded with a null value is unconfigured, and this refuses rather
   * than substituting a default: a threshold nobody set is not the same as a
   * threshold of zero, and silently treating it as one would misprice every
   * decision that depends on it.
   */
  /**
   * Reads a numeric setting, or null when it is unset or absent.
   *
   * For settings that are genuinely optional — a threshold nobody has
   * configured means "do not warn", not an error.
   */
  async optionalDecimal(key: SettingKeyName): Promise<Prisma.Decimal | null> {
    const setting = await this.prismaSafeFind(key);
    if (
      !setting ||
      setting.value === null ||
      typeof setting.value === 'object' ||
      (typeof setting.value !== 'number' && typeof setting.value !== 'string')
    ) {
      return null;
    }
    return new Prisma.Decimal(setting.value);
  }

  private prismaSafeFind(key: string): Promise<settings | null> {
    return this.repository.findByKey(key);
  }

  async requireDecimal(key: SettingKeyName): Promise<Prisma.Decimal> {
    const setting = await this.findOne(key);

    if (setting.value === null || typeof setting.value === 'object') {
      throw new ServiceUnavailableException(
        `Setting ${key} is not configured; an OWNER must set it`,
      );
    }
    if (typeof setting.value !== 'number' && typeof setting.value !== 'string') {
      throw new ServiceUnavailableException(
        `Setting ${key} is not a number: ${JSON.stringify(setting.value)}`,
      );
    }

    return new Prisma.Decimal(setting.value);
  }
}
