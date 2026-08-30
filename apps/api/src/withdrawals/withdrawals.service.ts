import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, currency_code, doc_type, documents, withdrawal_type } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { InvestorsService } from '../capital/investors.service';
import { toDecimal } from '../common/decimal';
import { CurrencyFifoService } from '../currency/currency-fifo.service';
import { parseBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashFlowCategory } from '../reports/cash-flow-category';
import { CreateWithdrawalDto } from './dto/withdrawal.dto';

/**
 * Owner / investor withdrawal (WDW) — §3.1.
 *
 * Money leaving the business to its owner or an investor. Cash really does go
 * out, so it is a cash outflow — but it is an equity movement, not an
 * operating expense: it does not reduce operating profit and never appears in
 * P&L expenses (§3.1.5, §3.1.6).
 *
 * The rule is structural rather than a check: this service writes an
 * account_movement and nothing else. It has no path to the expenses table,
 * so a withdrawal cannot become an expense however it is called.
 */
@Injectable()
export class WithdrawalsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.WDW;

  /** Every WDW is a capital/financing flow, whichever of the three types. */
  readonly cashFlowCategory = CashFlowCategory.CAPITAL_FINANCING;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly investors: InvestorsService,
    private readonly fifo: CurrencyFifoService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateWithdrawalDto, userId: string): Promise<documents> {
    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }

    // §3.1.2: returning capital has to say whose capital it is.
    if (dto.wtype === withdrawal_type.INVESTOR_CAPITAL_RETURN && !dto.investor_id) {
      throw new BadRequestException(
        'investor_id is required for INVESTOR_CAPITAL_RETURN',
      );
    }
    if (dto.investor_id) {
      await this.investors.findOne(dto.investor_id);
    }

    const account = await this.prisma.payment_accounts.findUnique({
      where: { id: dto.account_id },
    });
    if (!account) {
      throw new NotFoundException('account_id does not exist');
    }
    if (!account.is_active) {
      throw new BadRequestException('The account must be active');
    }

    if (dto.linked_capital_doc) {
      await this.assertLinkedCapitalDocument(dto.linked_capital_doc);
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.WDW,
        businessDate: parseBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await tx.withdrawal_docs.create({
        data: {
          document_id: document.id,
          wtype: dto.wtype,
          investor_id: dto.investor_id ?? null,
          account_id: dto.account_id,
          amount,
          currency: account.currency,
          linked_capital_doc: dto.linked_capital_doc ?? null,
          purpose: dto.purpose,
        },
      });

      return document;
    });
  }

  private async assertLinkedCapitalDocument(documentId: string): Promise<void> {
    const linked = await this.prisma.documents.findUnique({
      where: { id: documentId },
      select: { doc_type: true },
    });
    if (!linked) {
      throw new NotFoundException('linked_capital_doc does not exist');
    }
    if (linked.doc_type !== doc_type.CAP) {
      throw new BadRequestException(
        `linked_capital_doc must be a CAP document, not ${linked.doc_type}`,
      );
    }
  }

  /**
   * Confirm -> account_movement (−). Nothing is written to expenses.
   *
   * Taking money out of a foreign-currency till consumes its FIFO layers like
   * any other outflow, so the layers keep matching the balance (§10-А.3).
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const withdrawal = await tx.withdrawal_docs.findUnique({
      where: { document_id: document.id },
    });
    if (!withdrawal) {
      throw new NotFoundException(
        `Withdrawal body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      withdrawal.account_id,
    );

    let kgsValue: Prisma.Decimal | null = null;
    if (withdrawal.currency !== currency_code.KGS) {
      const consumption = await this.fifo.consumeCurrency(tx, {
        accountId: withdrawal.account_id,
        amount: withdrawal.amount,
        documentId: document.id,
        accountName: account.name,
      });
      kgsValue = consumption.kgsValue.negated();
    }

    await this.accounts.postMovement(tx, {
      accountId: withdrawal.account_id,
      documentId: document.id,
      amount: withdrawal.amount.negated(),
      kgsValue,
      currentBalance: balance,
      accountName: account.name,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'withdrawal_docs',
        entityId: document.id,
        action: 'CAPITAL_WITHDRAWN',
        newValue: {
          wtype: withdrawal.wtype,
          investor_id: withdrawal.investor_id,
          account_id: withdrawal.account_id,
          amount: `${withdrawal.amount.toFixed(2)} ${withdrawal.currency}`,
          cash_flow_category: this.cashFlowCategory,
        },
        reason: withdrawal.purpose,
      },
      tx,
    );
  }
}
