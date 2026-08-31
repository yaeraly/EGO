import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  claim_status,
  claim_type,
  claims,
  currency_code,
  discrepancy_status,
  doc_type,
  user_role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { roundMoney, toDecimal } from '../common/decimal';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompensateClaimDto,
  CreateClaimDto,
  UpdateClaimStatusDto,
} from './dto/claim.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Claim (CLM) — §8.5, §8.7.
 *
 * A loss someone else is answerable for. It exists so the money does not
 * quietly become a cost: goods that never arrived, or arrived broken, are
 * claimed from the supplier in yuan or the carrier in dollars, and only if
 * nobody pays does the OWNER write it off — with a reason, to an expense line
 * of its own that stays out of the bonus base (§8.5).
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly discrepancies: DiscrepanciesService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClaimDto, userId: string): Promise<claims> {
    const discrepancy = await this.discrepancies.findOne(dto.discrepancy_id);

    if (
      discrepancy.dstatus === discrepancy_status.CLOSED ||
      discrepancy.dstatus === discrepancy_status.WRITTEN_OFF
    ) {
      throw new ConflictException(
        `The discrepancy is ${discrepancy.dstatus}; a claim cannot be opened against it (§8.9)`,
      );
    }

    const existing = await this.prisma.claims.findFirst({
      where: {
        discrepancy_id: dto.discrepancy_id,
        cstatus: { notIn: [claim_status.CLOSED, claim_status.WRITTEN_OFF] },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This discrepancy already has an open claim (§8.5)',
      );
    }

    const receipt = await this.prisma.receipts.findUnique({
      where: { document_id: discrepancy.receipt_id },
      include: { purchases: true },
    });
    if (!receipt) {
      throw new NotFoundException('The receipt behind this discrepancy is missing');
    }

    const valued = await this.valueOf(discrepancy.document_id, dto.ctype);
    const amount = dto.amount ? toDecimal(dto.amount, 'amount') : valued.amount;

    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'A claim needs a positive amount; state one if the system cannot derive it (§8.5)',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.CLM,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? valued.note,
      });
      await this.documents.markConfirmedWithoutPosting(tx, document.id);

      const claim = await tx.claims.create({
        data: {
          document_id: document.id,
          ctype: dto.ctype,
          discrepancy_id: dto.discrepancy_id,
          supplier_id:
            dto.ctype === claim_type.SUPPLIER_CLAIM
              ? receipt.purchases.supplier_id
              : null,
          cargo_company_id:
            dto.ctype === claim_type.CARGO_CLAIM
              ? receipt.purchases.cargo_company_id
              : null,
          amount,
          currency:
            dto.ctype === claim_type.SUPPLIER_CLAIM
              ? currency_code.CNY
              : currency_code.USD,
        },
      });

      // The act is now under review rather than merely open (§8.9).
      await this.discrepancies.setStatusFromClaim(
        tx,
        dto.discrepancy_id,
        discrepancy_status.UNDER_REVIEW,
      );

      await this.audit.log(
        {
          userId,
          documentId: document.id,
          entity: 'claims',
          entityId: document.id,
          action: 'CLAIM_OPENED',
          newValue: {
            ctype: dto.ctype,
            discrepancy_id: dto.discrepancy_id,
            amount: amount.toFixed(2),
            currency: claim.currency,
            derived_amount: valued.amount.toFixed(2),
            goods_value: valued.goodsValue.toFixed(2),
            freight_share: valued.freightShare.toFixed(2),
          },
        },
        tx,
      );

      return claim;
    });
  }

  /**
   * What a discrepancy is worth as a claim (§8.5).
   *
   * A supplier claim is the price of the goods that never came. A cargo claim
   * adds their share of the freight that was actually paid to move them —
   * money spent carrying goods that were then lost, which §8.6 says must not
   * be reloaded onto the goods that did arrive.
   */
  async valueOf(
    discrepancyId: string,
    ctype: claim_type,
    db: Db = this.prisma,
  ): Promise<{
    amount: Prisma.Decimal;
    goodsValue: Prisma.Decimal;
    freightShare: Prisma.Decimal;
    note: string;
  }> {
    const discrepancy = await this.discrepancies.findOne(discrepancyId, db);
    const missingQty = discrepancy.diff_qty.isNegative()
      ? discrepancy.diff_qty.negated()
      : ZERO;

    const purchaseLine = await db.purchase_items.findFirst({
      where: {
        purchase_id: discrepancy.purchase_id,
        product_id: discrepancy.product_id,
      },
    });
    const priceCny = purchaseLine?.price_cny ?? ZERO;
    const goodsValueCny = roundMoney(missingQty.times(priceCny));

    if (ctype === claim_type.SUPPLIER_CLAIM) {
      return {
        amount: goodsValueCny,
        goodsValue: goodsValueCny,
        freightShare: ZERO,
        note: `${missingQty.toFixed(2)} даана товардын наркы (§8.5)`,
      };
    }

    // A cargo claim is in dollars, and the freight it carries is the share
    // paid for the lost units.
    const receipt = await db.receipts.findUnique({
      where: { document_id: discrepancy.receipt_id },
      include: { receipt_expenses: true },
    });
    const paidFreightKgs = (receipt?.receipt_expenses ?? [])
      .filter((expense) => expense.is_paid)
      .reduce((sum, expense) => sum.plus(expense.kgs_amount), ZERO);

    const orderedTotal = discrepancy.ordered_qty;
    const freightShareKgs = orderedTotal.greaterThan(0)
      ? roundMoney(paidFreightKgs.times(missingQty).dividedBy(orderedTotal))
      : ZERO;

    const rateUsd = receipt?.rate_usd ?? null;
    const rateCny = receipt?.rate_cny ?? null;

    if (rateUsd === null || rateUsd.lessThanOrEqualTo(0)) {
      // Without a USD rate the dollar figure would be invented; §8.5 wants a
      // real amount, so the caller must supply one.
      throw new ConflictException(
        'This receipt has no USD rate, so a cargo claim cannot be valued automatically; state the amount (§8.5, §10.1)',
      );
    }

    const goodsValueUsd =
      rateCny && rateCny.greaterThan(0)
        ? roundMoney(goodsValueCny.times(rateCny).dividedBy(rateUsd))
        : ZERO;
    const freightShareUsd = roundMoney(freightShareKgs.dividedBy(rateUsd));

    return {
      amount: goodsValueUsd.plus(freightShareUsd),
      goodsValue: goodsValueUsd,
      freightShare: freightShareUsd,
      note:
        `${missingQty.toFixed(2)} даана товардын наркы + ошого тиешелүү ` +
        'төлөнгөн логистика (§8.5)',
    };
  }

  /**
   * Records a compensation, in money or in goods (§8.7).
   *
   * Compensation in goods is the common case: the partner adds the missing
   * units to the next batch, which arrives as its own Receipt with its own
   * landed cost. What links the two is this row.
   */
  async compensate(
    documentId: string,
    dto: CompensateClaimDto,
    userId: string,
  ): Promise<claims> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.requireOpen(tx, documentId);
      const amount = toDecimal(dto.amount, 'amount');
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('amount must be greater than zero');
      }

      const already = await this.compensatedTotal(tx, documentId);
      const remaining = claim.amount.minus(already);
      if (amount.greaterThan(remaining)) {
        throw new ConflictException(
          `Only ${remaining.toFixed(2)} ${claim.currency} of this claim is still open`,
        );
      }

      if (dto.receipt_id) {
        const receipt = await tx.receipts.findUnique({
          where: { document_id: dto.receipt_id },
        });
        if (!receipt) {
          throw new NotFoundException('receipt_id does not exist');
        }
      }

      await tx.claim_compensations.create({
        data: {
          claim_id: documentId,
          receipt_id: dto.receipt_id ?? null,
          amount,
          comment: dto.comment ?? null,
        },
      });

      const total = already.plus(amount);
      const cstatus = total.greaterThanOrEqualTo(claim.amount)
        ? claim_status.COMPENSATED
        : claim_status.PARTIALLY_COMPENSATED;

      const updated = await tx.claims.update({
        where: { document_id: documentId },
        data: { cstatus },
      });

      if (claim.discrepancy_id) {
        await this.discrepancies.setStatusFromClaim(
          tx,
          claim.discrepancy_id,
          cstatus === claim_status.COMPENSATED
            ? discrepancy_status.COMPENSATED
            : discrepancy_status.PARTIALLY_COMPENSATED,
        );
      }

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'claims',
          entityId: documentId,
          action: 'CLAIM_COMPENSATED',
          newValue: {
            amount: amount.toFixed(2),
            currency: claim.currency,
            compensated_total: total.toFixed(2),
            claim_amount: claim.amount.toFixed(2),
            in_goods_receipt: dto.receipt_id ?? null,
            cstatus,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Moves the claim along its statuses (§8.5, §8.9).
   *
   * Writing one off is the OWNER's alone and needs a reason: the amount stops
   * being recoverable and becomes a stated loss, kept out of the bonus base.
   */
  async setStatus(
    documentId: string,
    dto: UpdateClaimStatusDto,
    userId: string,
    role: user_role,
  ): Promise<claims> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.require(tx, documentId);

      if (
        claim.cstatus === claim_status.CLOSED ||
        claim.cstatus === claim_status.WRITTEN_OFF
      ) {
        throw new ConflictException(
          `This claim is ${claim.cstatus} and no longer changes`,
        );
      }

      if (dto.cstatus === claim_status.WRITTEN_OFF) {
        if (role !== user_role.OWNER) {
          throw new ForbiddenException(
            'Only the OWNER writes off a claim (§8.5)',
          );
        }
        if (!dto.writeoff_reason) {
          throw new BadRequestException(
            'A write-off needs a stated reason (§8.5)',
          );
        }
      }
      if (
        dto.cstatus === claim_status.COMPENSATED ||
        dto.cstatus === claim_status.PARTIALLY_COMPENSATED
      ) {
        throw new BadRequestException(
          'Compensation status follows from recorded compensations; use the compensate endpoint (§8.7)',
        );
      }

      const updated = await tx.claims.update({
        where: { document_id: documentId },
        data: {
          cstatus: dto.cstatus,
          ...(dto.writeoff_reason
            ? { writeoff_reason: dto.writeoff_reason }
            : {}),
        },
      });

      if (claim.discrepancy_id) {
        const mapped =
          dto.cstatus === claim_status.WRITTEN_OFF
            ? discrepancy_status.WRITTEN_OFF
            : dto.cstatus === claim_status.CLOSED
              ? discrepancy_status.CLOSED
              : discrepancy_status.UNDER_REVIEW;
        await this.discrepancies.setStatusFromClaim(
          tx,
          claim.discrepancy_id,
          mapped,
        );
      }

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'claims',
          entityId: documentId,
          action:
            dto.cstatus === claim_status.WRITTEN_OFF
              ? 'CLAIM_WRITTEN_OFF'
              : 'CLAIM_STATUS_CHANGED',
          oldValue: { cstatus: claim.cstatus },
          newValue: {
            cstatus: dto.cstatus,
            amount: claim.amount.toFixed(2),
            currency: claim.currency,
            // §8.5: the loss goes to its own line and is excluded from the
            // bonus base; recorded here so the report can rely on it.
            expense_line: 'LOGISTICS_AND_SUPPLIER_LOSSES',
            excluded_from_bonus_base: true,
          },
          reason: dto.writeoff_reason,
        },
        tx,
      );

      return updated;
    });
  }

  async findOne(documentId: string, db: Db = this.prisma) {
    const claim = await db.claims.findUnique({
      where: { document_id: documentId },
      include: {
        documents: { select: { doc_number: true, business_date: true } },
        claim_compensations: { orderBy: { created_at: 'asc' } },
        discrepancies: true,
      },
    });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    const compensated = claim.claim_compensations.reduce(
      (sum, row) => sum.plus(row.amount),
      ZERO,
    );
    return {
      ...claim,
      compensated_total: compensated.toFixed(2),
      remaining: claim.amount.minus(compensated).toFixed(2),
    };
  }

  findMany(filter: { status?: claim_status; ctype?: claim_type }) {
    return this.prisma.claims.findMany({
      where: {
        ...(filter.status ? { cstatus: filter.status } : {}),
        ...(filter.ctype ? { ctype: filter.ctype } : {}),
      },
      include: {
        documents: { select: { doc_number: true, business_date: true } },
        claim_compensations: true,
      },
      orderBy: { documents: { created_at: 'desc' } },
    });
  }

  private async compensatedTotal(
    db: Db,
    claimId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await db.claim_compensations.findMany({
      where: { claim_id: claimId },
      select: { amount: true },
    });
    return rows.reduce((sum, row) => sum.plus(row.amount), ZERO);
  }

  private async requireOpen(db: Db, documentId: string): Promise<claims> {
    const claim = await this.require(db, documentId);
    if (
      claim.cstatus === claim_status.CLOSED ||
      claim.cstatus === claim_status.WRITTEN_OFF ||
      claim.cstatus === claim_status.COMPENSATED
    ) {
      throw new ConflictException(
        `This claim is ${claim.cstatus} and takes no further compensation`,
      );
    }
    return claim;
  }

  private async require(db: Db, documentId: string): Promise<claims> {
    const claim = await db.claims.findUnique({
      where: { document_id: documentId },
    });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    return claim;
  }
}
