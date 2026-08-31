import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationsService } from './reservations.service';

/**
 * Marks reservations whose time has run out (§17.3).
 *
 * The goods are already free: reserved quantity is computed from holds that
 * have not expired, so the moment `expires_at` passes the stock is sellable
 * again — "мөөнөтү бүткөн бронь автоматтык EXPIRED болуп, Reserved Stock дароо
 * бошотулат". This job records the status so the reservation list and the
 * OWNER's report say what happened; it is bookkeeping, not the release.
 */
@Injectable()
export class ReservationExpiryService {
  private readonly logger = new Logger(ReservationExpiryService.name);

  constructor(private readonly reservations: ReservationsService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'reservation-expiry' })
  async run(): Promise<void> {
    const expired = await this.reservations.expireDue();
    if (expired > 0) {
      this.logger.log(`${expired} reservation(s) marked EXPIRED (§17.3)`);
    }
  }
}
