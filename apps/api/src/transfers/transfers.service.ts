import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, doc_type, documents } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransfersRepository } from './transfers.repository';
import { CreateTransferDto } from './dto/transfer.dto';

/**
 * Account Transfer (TRN) — §19.
 *
 * Moves money between two accounts of the same currency. Converting between
 * currencies is a different document (CEX), which is why account_transfers
 * carries a single amount and no rate.
 */
@Injectable()
export class TransfersService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.TRN;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly repository: TransfersRepository,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  /**
   * Creates the transfer as a DRAFT. No money moves yet: a draft can still be
   * cancelled, and cancelling is only harmless while nothing has posted.
   */
  async create(dto: CreateTransferDto, userId: string): Promise<documents> {
    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }
    if (dto.from_account === dto.to_account) {
      throw new BadRequestException(
        'from_account and to_account must be different',
      );
    }

    const [from, to] = await Promise.all([
      this.accounts.findOptional(dto.from_account),
      this.accounts.findOptional(dto.to_account),
    ]);
    if (!from) {
      throw new NotFoundException('from_account does not exist');
    }
    if (!to) {
      throw new NotFoundException('to_account does not exist');
    }
    if (from.currency !== to.currency) {
      throw new BadRequestException(
        `A transfer cannot cross currencies (${from.currency} -> ${to.currency}); use a currency exchange (CEX)`,
      );
    }
    if (!from.is_active || !to.is_active) {
      throw new BadRequestException('Both accounts must be active');
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.TRN,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        fromAccount: dto.from_account,
        toAccount: dto.to_account,
        amount,
      });

      return document;
    });
  }

  /**
   * Posts the transfer: exactly two movements, minus then plus, in the
   * transaction that confirms the document. Both accounts are locked first, so
   * the balance the check reads is the balance the movement writes against.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const transfer = await this.repository.findByDocument(tx, document.id);
    if (!transfer) {
      throw new NotFoundException(
        `Transfer body missing for ${document.doc_number}`,
      );
    }

    const locked = await this.accounts.lockBalances(tx, [
      transfer.from_account,
      transfer.to_account,
    ]);
    const from = locked.get(transfer.from_account)!;
    const to = locked.get(transfer.to_account)!;

    // Refused here if the source cannot cover it — the confirmation fails and
    // the document stays a draft.
    await this.accounts.postMovement(tx, {
      accountId: transfer.from_account,
      documentId: document.id,
      amount: transfer.amount.negated(),
      currentBalance: from.balance,
      accountName: from.account.name,
    });

    await this.accounts.postMovement(tx, {
      accountId: transfer.to_account,
      documentId: document.id,
      amount: transfer.amount,
      currentBalance: to.balance,
      accountName: to.account.name,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'account_transfers',
        entityId: document.id,
        action: 'TRANSFER_POSTED',
        newValue: {
          from_account: transfer.from_account,
          to_account: transfer.to_account,
          amount: transfer.amount.toFixed(2),
        },
      },
      tx,
    );
  }
}
