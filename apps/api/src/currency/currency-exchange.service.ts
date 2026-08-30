import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, currency_code, doc_type, documents, payment_accounts } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { roundRate, toDecimal, toOptionalDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyExchangeRepository } from './currency-exchange.repository';
import { CurrencyFifoService } from './currency-fifo.service';
import { CreateCurrencyExchangeDto } from './dto/currency-exchange.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Currency Exchange (CEX) — §10-А.2.
 *
 * Buying foreign currency with KGS, or selling it back. One side is always
 * KGS: the knowledge base defines the document as "KGS менен валюта сатып алуу
 * (же тескерисинче)", and a foreign-to-foreign swap has no KGS rate to book a
 * layer at.
 */
@Injectable()
export class CurrencyExchangeService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.CEX;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly fifo: CurrencyFifoService,
    private readonly audit: AuditService,
    private readonly repository: CurrencyExchangeRepository,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(
    dto: CreateCurrencyExchangeDto,
    userId: string,
  ): Promise<documents> {
    const given = toDecimal(dto.given_amount, 'given_amount');
    const received = toDecimal(dto.received_amount, 'received_amount');
    const commission = toOptionalDecimal(dto.commission, 'commission') ?? ZERO;

    if (given.lessThanOrEqualTo(0) || received.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'given_amount and received_amount must both be greater than zero',
      );
    }
    if (commission.isNegative()) {
      throw new BadRequestException('commission cannot be negative');
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
    if (!from.is_active || !to.is_active) {
      throw new BadRequestException('Both accounts must be active');
    }

    const rate = this.deriveRate(from, to, given, received);

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.CEX,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        fromAccount: dto.from_account,
        toAccount: dto.to_account,
        givenAmount: given,
        receivedAmount: received,
        rate,
        commission,
        intermediary: dto.intermediary ?? null,
      });

      return document;
    });
  }

  /**
   * The rate is always KGS per unit of foreign currency, whichever way the
   * money is going, and it is derived from the amounts rather than accepted
   * from the caller — a rate that disagrees with the money that moved would
   * mis-cost every layer built on it.
   */
  private deriveRate(
    from: payment_accounts,
    to: payment_accounts,
    given: Prisma.Decimal,
    received: Prisma.Decimal,
  ): Prisma.Decimal {
    const buying = from.currency === currency_code.KGS;
    const selling = to.currency === currency_code.KGS;

    if (buying === selling) {
      throw new BadRequestException(
        buying
          ? 'A currency exchange must have exactly one foreign side; use a transfer (TRN) between KGS accounts'
          : `A currency exchange must have a KGS side (${from.currency} -> ${to.currency} is not supported)`,
      );
    }

    return buying
      ? roundRate(given.dividedBy(received))
      : roundRate(received.dividedBy(given));
  }

  /**
   * Posts the exchange.
   *
   * Buying: KGS leaves, currency arrives, and a new FIFO layer records what
   * that currency cost in KGS.
   *
   * Selling: the currency leaves oldest-layer-first, and the difference
   * between the KGS actually received and what those layers cost is FX
   * gain/loss (§10-А.2, §10.2) — a financial result, not a trading margin,
   * and outside the bonus base (§23.5).
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const exchange = await this.repository.findByDocument(tx, document.id);
    if (!exchange) {
      throw new NotFoundException(
        `Currency exchange body missing for ${document.doc_number}`,
      );
    }

    const locked = await this.accounts.lockBalances(tx, [
      exchange.from_account,
      exchange.to_account,
    ]);
    const from = locked.get(exchange.from_account)!;
    const to = locked.get(exchange.to_account)!;
    const buying = from.account.currency === currency_code.KGS;

    let fxGainLoss: Prisma.Decimal | null = null;
    let outgoingKgsValue: Prisma.Decimal | null = null;

    if (buying) {
      // KGS out. The KGS side needs the ordinary balance check.
      await this.accounts.postMovement(tx, {
        accountId: exchange.from_account,
        documentId: document.id,
        amount: exchange.given_amount.negated(),
        currentBalance: from.balance,
        accountName: from.account.name,
      });
    } else {
      // Currency out. Consuming the layers is itself the sufficiency check
      // (§10-А.4), and it yields what that currency cost.
      const consumption = await this.fifo.consumeCurrency(tx, {
        accountId: exchange.from_account,
        amount: exchange.given_amount,
        documentId: document.id,
        accountName: from.account.name,
      });
      outgoingKgsValue = consumption.kgsValue;
      fxGainLoss = exchange.received_amount.minus(consumption.kgsValue);

      await this.accounts.postMovement(tx, {
        accountId: exchange.from_account,
        documentId: document.id,
        amount: exchange.given_amount.negated(),
        kgsValue: outgoingKgsValue.negated(),
        currentBalance: from.balance,
        accountName: from.account.name,
      });
    }

    await this.accounts.postMovement(tx, {
      accountId: exchange.to_account,
      documentId: document.id,
      amount: exchange.received_amount,
      kgsValue: buying ? exchange.given_amount : null,
      currentBalance: to.balance,
      accountName: to.account.name,
    });

    if (buying) {
      await this.fifo.createLayer(tx, {
        accountId: exchange.to_account,
        documentId: document.id,
        amount: exchange.received_amount,
        rateKgs: exchange.rate,
      });
    } else {
      await this.repository.setFxGainLoss(tx, document.id, fxGainLoss!);
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'currency_exchanges',
        entityId: document.id,
        action: buying ? 'CURRENCY_BOUGHT' : 'CURRENCY_SOLD',
        newValue: {
          given: `${exchange.given_amount.toFixed(2)} ${from.account.currency}`,
          received: `${exchange.received_amount.toFixed(2)} ${to.account.currency}`,
          rate: exchange.rate.toString(),
          cost_basis_kgs: outgoingKgsValue?.toFixed(2) ?? null,
          fx_gain_loss_kgs: fxGainLoss?.toFixed(2) ?? null,
        },
      },
      tx,
    );
  }
}
