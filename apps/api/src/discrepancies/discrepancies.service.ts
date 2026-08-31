import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  discrepancies,
  discrepancy_status,
  discrepancy_type,
  doc_type,
  documents,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { roundMoney } from '../common/decimal';
import { DocumentsService } from '../documents/documents.service';
import { SupplierLedgerService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CostedLine } from '../receipts/landed-cost';
import { ReceiptFull } from '../receipts/receipts.repository';
import { UpdateDiscrepancyDto } from './dto/discrepancy.dto';

const ZERO = new Prisma.Decimal(0);

export interface ShortageSettlement {
  /** Yuan already paid for goods that never came → a receivable (§8.2). */
  receivableCny: Prisma.Decimal;
  /** Yuan not yet paid → the payable simply shrinks (§8.3). */
  payableReductionCny: Prisma.Decimal;
}

/**
 * How a shortage divides between §8.2 and §8.3.
 *
 * §8.3 states the rule in two halves: what was paid in advance becomes a
 * receivable, what was not yet paid reduces the payable. The paid share of
 * this order decides the split, so a half-paid order splits a shortage in
 * half — the same proportion that was genuinely at risk.
 *
 * Pure, because it decides money and is worth testing on its own.
 */
export function settleShortage(params: {
  /** Value of the missing goods, in CNY. */
  shortageCny: Prisma.Decimal;
  /** Confirmed payments against this order, in CNY. */
  paidCny: Prisma.Decimal;
  /** The order's full value, in CNY. */
  orderTotalCny: Prisma.Decimal;
}): ShortageSettlement {
  if (params.shortageCny.lessThanOrEqualTo(0)) {
    return { receivableCny: ZERO, payableReductionCny: ZERO };
  }
  if (params.orderTotalCny.lessThanOrEqualTo(0)) {
    return { receivableCny: ZERO, payableReductionCny: params.shortageCny };
  }

  const paid = Prisma.Decimal.min(params.paidCny, params.orderTotalCny);
  const receivable = roundMoney(
    params.shortageCny.times(paid).dividedBy(params.orderTotalCny),
  );

  return {
    receivableCny: receivable,
    // The remainder rather than a second division, so the two always add back
    // up to the shortage exactly.
    payableReductionCny: params.shortageCny.minus(receivable),
  };
}

/**
 * Discrepancy (DIF) — §8.
 *
 * Raised automatically when a receipt is confirmed and what arrived differs
 * from what was ordered, or when goods arrived damaged. A DIF is never
 * deleted (§8.9): every compensation, debt reduction, refund and write-off
 * that follows hangs off it.
 */
@Injectable()
export class DiscrepanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly ledger: SupplierLedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Compares ordered with received and raises what §8 requires.
   *
   * Two different things can be wrong with one line, and each gets its own
   * document because each is settled differently: a quantity that did not
   * arrive (UNKNOWN until someone determines whose fault it was, §8.4), and
   * goods that arrived broken (RECEIVING_DAMAGE, already in DEFECT).
   *
   * A shortage's financial consequence is applied straight away, because
   * §8.2–8.3 do not depend on knowing the cause: money paid for goods that
   * did not arrive is a receivable whoever lost them.
   */
  async raiseForReceipt(
    tx: Prisma.TransactionClient,
    params: {
      receipt: ReceiptFull;
      receiptDocument: documents;
      costedLines: CostedLine[];
      userId: string;
    },
  ): Promise<discrepancies[]> {
    const { receipt, receiptDocument, costedLines, userId } = params;
    const raised: discrepancies[] = [];

    const orderTotalCny = receipt.purchases.purchase_items.reduce(
      (sum, line) => sum.plus(line.qty.times(line.price_cny)),
      ZERO,
    );
    const paidCny = await this.confirmedPaidCny(tx, receipt.purchase_id);
    const rate = receipt.rate_cny!;

    for (const line of costedLines) {
      const difference = line.receivedQty.minus(line.orderedQty);
      const purchaseLine = receipt.purchases.purchase_items.find(
        (row) => row.product_id === line.productId,
      );
      const priceCny = purchaseLine?.price_cny ?? ZERO;

      if (difference.isNegative()) {
        const shortageQty = difference.negated();
        const shortageCny = roundMoney(shortageQty.times(priceCny));

        const document = await this.open(tx, {
          receipt,
          receiptDocument,
          line,
          diffQty: difference,
          dtype: discrepancy_type.UNKNOWN,
          userId,
          comment: `${shortageQty.toFixed(2)} × ${line.sku} жетишпейт`,
        });

        // §8.2 / §8.3 — what the missing goods mean financially.
        const settlement = settleShortage({
          shortageCny,
          paidCny,
          orderTotalCny,
        });

        if (settlement.receivableCny.greaterThan(0)) {
          await this.ledger.recordReceivable(tx, {
            supplierId: receipt.purchases.supplier_id,
            documentId: document.document_id,
            amountCny: settlement.receivableCny,
            kgsValue: roundMoney(settlement.receivableCny.times(rate)),
          });
        }
        if (settlement.payableReductionCny.greaterThan(0)) {
          await this.ledger.reducePayable(tx, {
            supplierId: receipt.purchases.supplier_id,
            documentId: document.document_id,
            amountCny: settlement.payableReductionCny,
            kgsValue: roundMoney(settlement.payableReductionCny.times(rate)),
          });
        }

        await this.audit.log(
          {
            userId,
            documentId: document.document_id,
            entity: 'discrepancies',
            entityId: document.document_id,
            action: 'DISCREPANCY_SETTLED',
            newValue: {
              sku: line.sku,
              shortage_qty: shortageQty.toFixed(2),
              shortage_cny: shortageCny.toFixed(2),
              paid_cny: paidCny.toFixed(2),
              order_total_cny: orderTotalCny.toFixed(2),
              receivable_cny: settlement.receivableCny.toFixed(2),
              payable_reduction_cny: settlement.payableReductionCny.toFixed(2),
            },
          },
          tx,
        );

        raised.push(document);
      } else if (difference.greaterThan(0)) {
        // §8.8: excess is not free goods. The act stays open until the OWNER
        // records a decision, and nothing is valued in the meantime.
        raised.push(
          await this.open(tx, {
            receipt,
            receiptDocument,
            line,
            diffQty: difference,
            dtype: discrepancy_type.EXCESS,
            userId,
            comment:
              `${difference.toFixed(2)} × ${line.sku} ашыкча келди — ` +
              'OWNER чечимине чейин ачык турат (§8.8)',
          }),
        );
      }

      if (line.damagedQty.greaterThan(0)) {
        // §8.4 (v2.1): the goods were accepted and are in DEFECT at their own
        // landed cost; what is open is who pays for them.
        raised.push(
          await this.open(tx, {
            receipt,
            receiptDocument,
            line,
            diffQty: line.damagedQty.negated(),
            dtype: discrepancy_type.RECEIVING_DAMAGE,
            userId,
            comment:
              `${line.damagedQty.toFixed(2)} × ${line.sku} брак — DEFECT складда, ` +
              `бирдиктин наркы ${line.unitLandedCost.toFixed(4)} KGS (§8.4)`,
          }),
        );
      }
    }

    return raised;
  }

  /**
   * Reclassifies a discrepancy once the cause is known (§8.4).
   *
   * UNKNOWN is the honest starting point: at the warehouse door nobody knows
   * whether the supplier under-shipped or the carrier lost a box. The change
   * is audited because it decides who is claimed against.
   */
  async update(
    documentId: string,
    dto: UpdateDiscrepancyDto,
    userId: string,
  ): Promise<discrepancies> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.require(tx, documentId);

      if (
        before.dstatus === discrepancy_status.CLOSED ||
        before.dstatus === discrepancy_status.WRITTEN_OFF
      ) {
        throw new ConflictException(
          `This discrepancy is ${before.dstatus} and no longer changes (§8.9)`,
        );
      }
      if (
        dto.dstatus === discrepancy_status.WRITTEN_OFF &&
        !dto.financial_decision
      ) {
        throw new BadRequestException(
          'A write-off needs a stated financial decision (§8.5)',
        );
      }

      const updated = await tx.discrepancies.update({
        where: { document_id: documentId },
        data: {
          ...(dto.dtype ? { dtype: dto.dtype } : {}),
          ...(dto.dstatus ? { dstatus: dto.dstatus } : {}),
          ...(dto.financial_decision !== undefined
            ? { financial_decision: dto.financial_decision }
            : {}),
        },
      });

      await this.audit.log(
        {
          userId,
          documentId,
          entity: 'discrepancies',
          entityId: documentId,
          action: 'DISCREPANCY_UPDATED',
          oldValue: {
            dtype: before.dtype,
            dstatus: before.dstatus,
            financial_decision: before.financial_decision,
          },
          newValue: {
            dtype: updated.dtype,
            dstatus: updated.dstatus,
            financial_decision: updated.financial_decision,
          },
          reason: dto.reason,
        },
        tx,
      );

      return updated;
    });
  }

  findOne(documentId: string, db: Db = this.prisma): Promise<discrepancies> {
    return this.require(db, documentId);
  }

  /**
   * The act as a screen needs it: with its document number and its product.
   *
   * `findOne` returns the bare row for callers that only need the figures
   * (a claim being valued, say); this is what the card reads.
   */
  async findOneDetailed(documentId: string, db: Db = this.prisma) {
    const found = await db.discrepancies.findUnique({
      where: { document_id: documentId },
      include: {
        documents: { select: { doc_number: true, business_date: true } },
        products: { select: { id: true, sku: true, name: true } },
      },
    });
    if (!found) {
      throw new NotFoundException('Discrepancy not found');
    }
    return found;
  }

  findMany(filter: {
    receiptId?: string;
    status?: discrepancy_status;
    dtype?: discrepancy_type;
  }) {
    return this.prisma.discrepancies.findMany({
      where: {
        ...(filter.receiptId ? { receipt_id: filter.receiptId } : {}),
        ...(filter.status ? { dstatus: filter.status } : {}),
        ...(filter.dtype ? { dtype: filter.dtype } : {}),
      },
      include: {
        documents: { select: { doc_number: true, business_date: true } },
        products: { select: { id: true, sku: true, name: true } },
      },
      orderBy: { documents: { created_at: 'desc' } },
    });
  }

  /** Sets the status from a claim's progress (§8.7, §8.9). */
  async setStatusFromClaim(
    tx: Prisma.TransactionClient,
    documentId: string,
    dstatus: discrepancy_status,
  ): Promise<void> {
    await tx.discrepancies.update({
      where: { document_id: documentId },
      data: { dstatus },
    });
  }

  private async open(
    tx: Prisma.TransactionClient,
    params: {
      receipt: ReceiptFull;
      receiptDocument: documents;
      line: CostedLine;
      diffQty: Prisma.Decimal;
      dtype: discrepancy_type;
      userId: string;
      comment: string;
    },
  ): Promise<discrepancies> {
    const document = await this.documents.create(tx, {
      docType: doc_type.DIF,
      businessDate: params.receiptDocument.business_date,
      userId: params.userId,
      comment: params.comment,
    });
    await this.documents.markConfirmedWithoutPosting(tx, document.id);

    return tx.discrepancies.create({
      data: {
        document_id: document.id,
        receipt_id: params.receipt.document_id,
        purchase_id: params.receipt.purchase_id,
        product_id: params.line.productId,
        ordered_qty: params.line.orderedQty,
        received_qty: params.line.receivedQty,
        diff_qty: params.diffQty,
        dtype: params.dtype,
      },
    });
  }

  private async confirmedPaidCny(
    tx: Prisma.TransactionClient,
    purchaseId: string,
  ): Promise<Prisma.Decimal> {
    const [row] = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(p.amount_cny), 0) AS total
      FROM supplier_payments p
      JOIN documents d ON d.id = p.document_id
      WHERE p.purchase_id = ${purchaseId}::uuid AND d.status = 'CONFIRMED'
    `;
    return row.total ?? ZERO;
  }

  private async require(db: Db, documentId: string): Promise<discrepancies> {
    const found = await db.discrepancies.findUnique({
      where: { document_id: documentId },
    });
    if (!found) {
      throw new NotFoundException('Discrepancy not found');
    }
    return found;
  }
}
