import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, capital_source, currency_code, doc_type, documents } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { roundMoney, toDecimal, toOptionalDecimal } from '../common/decimal';
import { CurrencyFifoService } from '../currency/currency-fifo.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CapitalRepository } from './capital.repository';
import { CreateCapitalDto } from './dto/capital.dto';
import { InvestorsService } from './investors.service';

/**
 * Capital In (CAP) — §3.
 *
 * Money entering the business from the owner or an investor. It increases a
 * company account and the corresponding equity balance; it is never revenue.
 */
@Injectable()
export class CapitalService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.CAP;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly investors: InvestorsService,
    private readonly fifo: CurrencyFifoService,
    private readonly audit: AuditService,
    private readonly repository: CapitalRepository,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateCapitalDto, userId: string): Promise<documents> {
    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }

    if (dto.source === capital_source.INVESTOR) {
      if (!dto.investor_id) {
        throw new BadRequestException(
          'investor_id is required when source is INVESTOR',
        );
      }
      await this.investors.findOne(dto.investor_id);
    } else if (dto.investor_id) {
      throw new BadRequestException(
        'investor_id must be omitted when source is OWNER',
      );
    }

    const account = await this.accounts.findOptional(dto.account_id);
    if (!account) {
      throw new NotFoundException('account_id does not exist');
    }
    if (!account.is_active) {
      throw new BadRequestException('The account must be active');
    }

    const rate = this.requireRateForForeignCurrency(
      account.currency,
      toOptionalDecimal(dto.rate, 'rate'),
    );

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.CAP,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      // The currency is the account's; capital cannot arrive in a currency
      // the account does not hold.
      await this.repository.insert(tx, {
        documentId: document.id,
        source: dto.source,
        investorId: dto.investor_id ?? null,
        accountId: dto.account_id,
        amount,
        currency: account.currency,
        rate,
      });

      return document;
    });
  }

  /**
   * Capital contributed straight into a foreign-currency till needs its KGS
   * rate.
   *
   * §10-А.3 keeps a currency till's KGS value in FIFO layers, and a layer
   * cannot exist without a rate. Without one, the first payment out of that
   * till would have no cost basis to draw on.
   */
  private requireRateForForeignCurrency(
    currency: currency_code,
    rate: Prisma.Decimal | undefined,
  ): Prisma.Decimal | null {
    if (currency === currency_code.KGS) {
      return null;
    }
    if (!rate || rate.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        `rate is required for a ${currency} account: it is the KGS cost of the currency and becomes its FIFO layer rate`,
      );
    }
    return rate;
  }

  /** Confirm -> account_movement (+), and a FIFO layer if the till is foreign. */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const capital = await this.repository.findByDocument(tx, document.id);
    if (!capital) {
      throw new NotFoundException(
        `Capital body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      capital.account_id,
    );

    const foreign = capital.currency !== currency_code.KGS;
    const kgsValue =
      foreign && capital.rate
        ? roundMoney(capital.amount.times(capital.rate))
        : null;

    await this.accounts.postMovement(tx, {
      accountId: capital.account_id,
      documentId: document.id,
      amount: capital.amount,
      kgsValue,
      currentBalance: balance,
      accountName: account.name,
    });

    if (foreign && capital.rate) {
      await this.fifo.createLayer(tx, {
        accountId: capital.account_id,
        documentId: document.id,
        amount: capital.amount,
        rateKgs: capital.rate,
      });
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'capital_docs',
        entityId: document.id,
        action: 'CAPITAL_CONTRIBUTED',
        newValue: {
          source: capital.source,
          investor_id: capital.investor_id,
          account_id: capital.account_id,
          amount: `${capital.amount.toFixed(2)} ${capital.currency}`,
          kgs_value: kgsValue?.toFixed(2) ?? null,
        },
      },
      tx,
    );
  }
}
