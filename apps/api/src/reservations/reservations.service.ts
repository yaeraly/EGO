import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  doc_type,
  documents,
  reservation_status,
  user_role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { CreditService } from '../credit/credit.service';
import { CustomersService } from '../customers/customers.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  AdvanceRequirement,
  ReservationPolicy,
  defaultExpiry,
  noAdvanceDeadline,
  requiredAdvance,
} from './reservation-policy';
import { ReservationFull, ReservationsRepository } from './reservations.repository';
import { CancelReservationDto, CreateReservationDto } from './dto/reservation.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Reservation (RSV) — §17.
 *
 * A reservation holds goods for one customer and nobody else (§42.2), at a
 * price fixed on the day it is made (§17.1). It holds them for a stated time
 * and no longer: §17.3 is emphatic that a reservation is not a way to block
 * stock indefinitely for free, so the hold ends at `expires_at` whether or
 * not anything has run since.
 *
 * Nothing here moves stock. Reserved is a *claim* on stock, computed from the
 * live reservations, which is why an expiry needs no compensating movement
 * and no document to reverse.
 */
@Injectable()
export class ReservationsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.RSV;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: ReservationsRepository,
    private readonly customers: CustomersService,
    private readonly products: ProductsService,
    private readonly pricing: PricingService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly credit: CreditService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  /** The OWNER's §17.3 policy, read as stored — unset stays unset. */
  async policy(): Promise<ReservationPolicy> {
    const [above, pct, maxActive, noAdvanceHours, duration] = await Promise.all([
      this.settings.optionalDecimal(SettingKey.RESERVATION_ADVANCE_REQUIRED_ABOVE_KGS),
      this.settings.optionalDecimal(SettingKey.RESERVATION_MIN_ADVANCE_PCT),
      this.settings.optionalDecimal(SettingKey.RESERVATION_MAX_ACTIVE_PER_CUSTOMER),
      this.settings.optionalDecimal(SettingKey.RESERVATION_MAX_NO_ADVANCE_HOURS),
      this.settings.optionalDecimal(SettingKey.RESERVATION_DEFAULT_DURATION_HOURS),
    ]);

    return {
      advanceRequiredAboveKgs: above,
      minAdvancePct: pct,
      maxActivePerCustomer: maxActive === null ? null : maxActive.toNumber(),
      maxNoAdvanceHours:
        noAdvanceHours === null ? null : noAdvanceHours.toNumber(),
      defaultDurationHours: duration === null ? null : duration.toNumber(),
    };
  }

  /**
   * Creates a reservation as a draft.
   *
   * The stock is not held yet — confirming does that, because §42.2's promise
   * is only worth making once the document is a fact.
   */
  async create(
    dto: CreateReservationDto,
    userId: string,
    role: user_role,
  ): Promise<documents> {
    const customer = await this.customers.findOne(dto.customer_id);
    if (customer.is_walk_in) {
      // §17.3: "Walk-in Customer үчүн Reservation жана Advance колдонулбайт".
      throw this.customers.walkInRefusal('RESERVATION');
    }
    if (!customer.is_active) {
      throw new BadRequestException('Кардар активдүү эмес');
    }

    const policy = await this.policy();
    const now = new Date();

    const expiresAt = dto.expires_at
      ? new Date(dto.expires_at)
      : defaultExpiry(now, policy);
    if (!expiresAt) {
      throw new BadRequestException(
        'Броннун аяктоо убактысы милдеттүү (§17). Демейки мөөнөт коюлган эмес — ' +
          `${SettingKey.RESERVATION_DEFAULT_DURATION_HOURS} параметрин коюңуз же убакытты көрсөтүңүз`,
      );
    }
    if (expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('Броннун аяктоо убактысы келечекте болушу керек (§17)');
    }

    const warehouse = await this.warehouses.main();
    const lines = await this.priceLines(dto, customer.id, warehouse.id);
    const total = lines.reduce((sum, line) => sum.plus(line.amount), ZERO);

    const requirement = requiredAdvance({
      total,
      policy,
      products: lines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        advanceRequired: line.advanceRequired,
        minAdvancePct: line.minAdvancePct,
      })),
    });

    if (requirement.reason !== 'NONE' && requirement.pct === null) {
      throw new UnprocessableEntityException(
        `Бул бронго аванс милдеттүү (${requirement.reason === 'PRODUCT_RULE' ? requirement.productSku : 'сумма чегинен жогору'}), ` +
          `бирок ${SettingKey.RESERVATION_MIN_ADVANCE_PCT} коюлган эмес — ЭЭСИ пайызды койсун (§17.3)`,
      );
    }

    // A reservation with no advance is time-boxed (§17.3).
    if (requirement.required.lessThanOrEqualTo(ZERO)) {
      const deadline = noAdvanceDeadline(now, policy);
      if (deadline && expiresAt.getTime() > deadline.getTime()) {
        throw new UnprocessableEntityException(
          `Аванссыз бронь ${policy.maxNoAdvanceHours} сааттан ашпайт (§17.3) — ` +
            `эң кеч ${deadline.toISOString()}`,
        );
      }
    }

    await this.assertCustomerMayReserve(this.prisma, {
      customerId: customer.id,
      policy,
      role,
      overrideReason: dto.override_reason,
      userId,
    });

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.RSV,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        customerId: customer.id,
        salesperson: userId,
        expiresAt,
        totalAmount: total,
        advanceRequired: requirement.required,
      });

      await this.repository.insertItems(
        tx,
        document.id,
        lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          fixedPrice: line.fixedPrice,
        })),
      );

      return document;
    });
  }

  /**
   * Confirming is where the hold starts (§42.2).
   *
   * The availability check happens here, inside the confirming transaction,
   * against everything else already reserved — two clerks promising the same
   * last motor to two customers must end with one reservation and one refusal.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const reservation = await this.requireReservation(tx, document.id);
    const warehouse = await this.warehouses.main();

    if (reservation.expires_at.getTime() <= Date.now()) {
      throw new ConflictException(
        'Броннун мөөнөтү өтүп кеткен — жаңы бронь түзүңүз (§17)',
      );
    }

    const products = await this.products.requireActive(
      tx,
      reservation.reservation_items.map((item) => item.product_id),
    );

    for (const item of reservation.reservation_items) {
      const product = products.get(item.product_id)!;
      // Before reading: two confirmations for the same last unit have no row
      // of their own to collide on, so they queue here instead.
      await this.stock.lockProductStock(tx, item.product_id, warehouse.id);

      const onHand = await this.stock.onHandInWarehouse(
        item.product_id,
        warehouse.id,
        tx,
      );
      const reserved = await this.stock.reserved(
        item.product_id,
        tx,
        document.id,
      );
      const free = onHand.minus(reserved);
      if (item.qty.greaterThan(free)) {
        throw new ConflictException(
          `${product.sku}: брондоого ${Prisma.Decimal.max(free, ZERO).toFixed(2)} гана бар ` +
            `(складда ${onHand.toFixed(2)}, брондолгон ${reserved.toFixed(2)}) — §42.2`,
        );
      }
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'reservations',
        entityId: document.id,
        action: 'RESERVATION_CONFIRMED',
        newValue: {
          customer_id: reservation.customer_id,
          total_amount: reservation.total_amount.toFixed(2),
          advance_required: reservation.advance_required.toFixed(2),
          expires_at: reservation.expires_at.toISOString(),
          items: reservation.reservation_items.map((item) => ({
            product_id: item.product_id,
            qty: item.qty.toFixed(2),
            fixed_price: item.fixed_price.toFixed(2),
          })),
        },
      },
      tx,
    );
  }

  /**
   * Cancels a live reservation (§17.2).
   *
   * The stock frees itself, because reserved is derived from ACTIVE holds.
   * Any advance is refunded separately, by the advance's own document — the
   * money and the hold are two facts, and §17-А.4 keeps them that way.
   */
  async cancel(
    id: string,
    dto: CancelReservationDto,
    userId: string,
  ): Promise<ReservationFull> {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.requireReservation(tx, id);
      if (reservation.rstatus !== reservation_status.ACTIVE) {
        throw new ConflictException(
          `Бул бронь ${reservation.rstatus} — жокко чыгарылбайт (§17)`,
        );
      }

      await this.repository.setStatus(tx, id, reservation_status.CANCELLED, {
        cancelReason: dto.reason.trim(),
      });

      await this.audit.log(
        {
          userId,
          documentId: id,
          entity: 'reservations',
          entityId: id,
          action: 'RESERVATION_CANCELLED',
          oldValue: { rstatus: reservation.rstatus },
          newValue: { rstatus: reservation_status.CANCELLED },
          reason: dto.reason.trim(),
        },
        tx,
      );

      return this.requireReservation(tx, id);
    });
  }

  /**
   * Marks reservations whose time has run out (§17.3).
   *
   * Their stock is already free — the reserved-quantity query ignores an
   * expired hold from the moment it expires — so this records the status
   * rather than releasing anything. A job that fails to run therefore delays
   * a label, not the goods.
   */
  async expireDue(): Promise<number> {
    const due = await this.repository.expired(this.prisma);
    for (const reservation of due) {
      await this.prisma.$transaction(async (tx) => {
        await this.repository.setStatus(
          tx,
          reservation.document_id,
          reservation_status.EXPIRED,
        );
        await this.audit.log(
          {
            userId: null,
            documentId: reservation.document_id,
            entity: 'reservations',
            entityId: reservation.document_id,
            action: 'RESERVATION_EXPIRED',
            oldValue: { rstatus: reservation_status.ACTIVE },
            newValue: {
              rstatus: reservation_status.EXPIRED,
              expires_at: reservation.expires_at.toISOString(),
            },
          },
          tx,
        );
      });
    }
    return due.length;
  }

  findMany(filter: {
    customerId?: string;
    status?: reservation_status;
    salesperson?: string;
  }): Promise<ReservationFull[]> {
    return this.repository.findMany(filter);
  }

  async findOne(id: string, db: Db = this.prisma): Promise<ReservationFull> {
    return this.requireReservation(db, id);
  }

  /** Live means: confirmed, ACTIVE, and not yet past its expiry (§17.3). */
  isLive(reservation: ReservationFull): boolean {
    return (
      reservation.rstatus === reservation_status.ACTIVE &&
      reservation.documents.status === 'CONFIRMED' &&
      reservation.expires_at.getTime() > Date.now()
    );
  }

  async markFulfilled(
    tx: Prisma.TransactionClient,
    reservationId: string,
    saleId: string,
  ): Promise<void> {
    await this.repository.setStatus(
      tx,
      reservationId,
      reservation_status.FULFILLED,
      { fulfilledSale: saleId },
    );
  }

  private async requireReservation(db: Db, id: string): Promise<ReservationFull> {
    const reservation = await this.repository.findById(db, id);
    if (!reservation) {
      throw new NotFoundException('Бронь табылган жок');
    }
    return reservation;
  }

  /**
   * §16.4 and §17.3 — the two reasons a customer may not reserve right now.
   *
   * Both are the OWNER's to override, both need a reason, and both reach the
   * Audit Log, exactly as §16.5 requires of a credit override.
   */
  private async assertCustomerMayReserve(
    db: Db,
    params: {
      customerId: string;
      policy: ReservationPolicy;
      role: user_role;
      overrideReason?: string;
      userId: string;
    },
  ): Promise<void> {
    const blocks: { code: string; message: string }[] = [];

    const standing = await this.credit.standing(params.customerId, db);
    const overdue = new Prisma.Decimal(standing.overdue_amount);
    if (overdue.greaterThan(ZERO)) {
      blocks.push({
        code: 'OVERDUE',
        message: `Кардардын мөөнөтү өткөн карызы бар (${overdue.toFixed(2)} сом) — жаңы бронь түзүлбөйт (§16.4)`,
      });
    }

    if (params.policy.maxActivePerCustomer !== null) {
      const active = await this.repository.activeCountForCustomer(
        db,
        params.customerId,
      );
      if (active >= params.policy.maxActivePerCustomer) {
        blocks.push({
          code: 'MAX_ACTIVE_RESERVATIONS',
          message: `Кардарда ${active} активдүү бронь бар, лимит ${params.policy.maxActivePerCustomer} (§17.3)`,
        });
      }
    }

    if (blocks.length === 0) {
      return;
    }

    if (params.role !== user_role.OWNER || !params.overrideReason?.trim()) {
      throw new UnprocessableEntityException({
        message: blocks.map((block) => block.message).join('; '),
        code: blocks[0].code,
        blocks,
      });
    }

    await this.audit.log({
      userId: params.userId,
      entity: 'reservations',
      entityId: params.customerId,
      action: 'RESERVATION_BLOCK_OVERRIDDEN',
      newValue: { blocks: blocks.map((block) => block.code) },
      reason: params.overrideReason.trim(),
    });
  }

  /**
   * Prices the lines as of today (§17.1).
   *
   * The price is fixed here and stored, so the customer is charged what they
   * were quoted. §17.1 still has the sale re-check §13.4 at confirmation: if
   * cost has risen past the fixed price in the meantime, the OWNER decides.
   */
  private async priceLines(
    dto: CreateReservationDto,
    customerId: string,
    warehouseId: string,
  ): Promise<
    {
      productId: string;
      sku: string;
      qty: Prisma.Decimal;
      fixedPrice: Prisma.Decimal;
      amount: Prisma.Decimal;
      advanceRequired: boolean;
      minAdvancePct: Prisma.Decimal | null;
    }[]
  > {
    const products = await this.products.requireActive(
      this.prisma,
      dto.items.map((item) => item.product_id),
    );

    const lines = [];
    for (const item of dto.items) {
      const qty = toDecimal(item.qty, 'qty');
      if (qty.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException('qty оң сан болушу керек');
      }

      const product = products.get(item.product_id)!;
      const suggestion = await this.pricing.suggest({
        productId: item.product_id,
        customerId,
        warehouseId,
        qty,
      });
      const fixedPrice = new Prisma.Decimal(suggestion.auto_price);

      lines.push({
        productId: item.product_id,
        sku: product.sku,
        qty,
        fixedPrice,
        amount: fixedPrice.times(qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        advanceRequired: product.reservation_advance_required,
        minAdvancePct: product.reservation_min_advance_pct,
      });
    }
    return lines;
  }

  /** The requirement, recomputed for a screen that wants to explain it. */
  async requirementFor(
    reservation: ReservationFull,
  ): Promise<AdvanceRequirement> {
    const policy = await this.policy();
    const products = await this.products.requireActive(
      this.prisma,
      reservation.reservation_items.map((item) => item.product_id),
    );
    return requiredAdvance({
      total: reservation.total_amount,
      policy,
      products: [...products.values()].map((product) => ({
        productId: product.id,
        sku: product.sku,
        advanceRequired: product.reservation_advance_required,
        minAdvancePct: product.reservation_min_advance_pct,
      })),
    });
  }
}
