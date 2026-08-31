import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, doc_type, documents } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CreateDefectDto, DecideDefectDto } from './dto/defect.dto';

export type DefectFull = Prisma.defect_actsGetPayload<{
  include: { products: true; documents: true };
}>;

const ZERO = new Prisma.Decimal(0);

/**
 * Defect act (DEF) — §36-А.3, §37.
 *
 * The goods are already in DEFECT by the time an act is written: a return
 * with a defective condition put them there (§35.3), or damage on arrival did
 * (§8.4). What §37 asks for is the record — which product, how many, from
 * which sale or receipt, why, who inspected it, and what was decided.
 *
 * The act therefore moves nothing. It is the decision that matters, and the
 * decision is a person's: §36-А.3 has warranty cover factory defects only,
 * and misuse or water damage is judged, not computed.
 */
@Injectable()
export class DefectsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.DEF;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateDefectDto, userId: string): Promise<documents> {
    const qty = toDecimal(dto.qty, 'qty');
    if (qty.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('Саны оң болушу керек');
    }

    await this.products.requireActive(this.prisma, [dto.product_id]);

    // §37 keeps the origin: which sale the customer brought it back from, or
    // which receipt it arrived damaged on. An act with neither is a defect
    // nobody can trace, which is what §37's list exists to prevent.
    if (!dto.return_id && !dto.discrepancy_id) {
      throw new BadRequestException(
        'Брак акты возвратка же приходдогу расхождениеге байланышы керек (§37)',
      );
    }
    if (dto.return_id) {
      const source = await this.prisma.returns.findUnique({
        where: { document_id: dto.return_id },
        select: { document_id: true },
      });
      if (!source) {
        throw new NotFoundException('Возврат табылган жок');
      }
    }
    if (dto.discrepancy_id) {
      const source = await this.prisma.discrepancies.findUnique({
        where: { document_id: dto.discrepancy_id },
        select: { document_id: true },
      });
      if (!source) {
        throw new NotFoundException('Расхождение табылган жок');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.DEF,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await tx.defect_acts.create({
        data: {
          document_id: document.id,
          return_id: dto.return_id ?? null,
          discrepancy_id: dto.discrepancy_id ?? null,
          product_id: dto.product_id,
          qty,
          reason: dto.reason.trim(),
          decision: dto.decision ?? null,
          checked_by: userId,
        },
      });

      return document;
    });
  }

  /** §37 — the decision, and who reached it. */
  async decide(
    id: string,
    dto: DecideDefectDto,
    userId: string,
  ): Promise<DefectFull> {
    return this.prisma.$transaction(async (tx) => {
      const act = await this.requireDefect(tx, id);
      if (act.documents.status === 'CONFIRMED') {
        throw new ConflictException(
          'Тастыкталган акт өзгөртүлбөйт — жаңы акт түзүңүз (§27.1)',
        );
      }

      await tx.defect_acts.update({
        where: { document_id: id },
        data: {
          decision: dto.decision,
          checked_by: userId,
          ...(dto.reason ? { reason: dto.reason.trim() } : {}),
        },
      });

      return this.requireDefect(tx, id);
    });
  }

  /** Confirming records the act; nothing moves (§37). */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const act = await this.requireDefect(tx, document.id);
    if (!act.decision) {
      throw new ConflictException(
        'Чечими жок брак акты тастыкталбайт: EXCHANGE / REFUND / CLAIM / WRITEOFF (§37)',
      );
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'defect_acts',
        entityId: document.id,
        action: 'DEFECT_ACT_CONFIRMED',
        newValue: {
          product_id: act.product_id,
          qty: act.qty.toFixed(2),
          decision: act.decision,
          return_id: act.return_id,
          discrepancy_id: act.discrepancy_id,
          checked_by: act.checked_by,
        },
        reason: act.reason,
      },
      tx,
    );
  }

  findMany(filter: {
    productId?: string;
    decision?: string;
  }): Promise<DefectFull[]> {
    return this.prisma.defect_acts.findMany({
      where: {
        ...(filter.productId ? { product_id: filter.productId } : {}),
        ...(filter.decision ? { decision: filter.decision } : {}),
      },
      include: { products: true, documents: true },
      orderBy: { documents: { created_at: 'desc' } },
      take: 100,
    });
  }

  findOne(id: string, db: Db = this.prisma): Promise<DefectFull> {
    return this.requireDefect(db, id);
  }

  private async requireDefect(db: Db, id: string): Promise<DefectFull> {
    const act = await db.defect_acts.findUnique({
      where: { document_id: id },
      include: { products: true, documents: true },
    });
    if (!act) {
      throw new NotFoundException('Брак акты табылган жок');
    }
    return act;
  }
}
