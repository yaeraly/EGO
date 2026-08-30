import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, currency_code, doc_type, documents } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { roundMoney, roundRate, toDecimal, toOptionalDecimal } from '../common/decimal';
import { CargoCompaniesService } from '../counterparties/counterparties.service';
import { CurrencyFifoService } from '../currency/currency-fifo.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { CargoLedgerService, splitAgainstDebt } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CargoPaymentsRepository } from './cargo-payments.repository';
import { CreateCargoPaymentDto } from './dto/cargo-payment.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Cargo Payment (CPY) — §5.2.
 *
 * The carrier bills in dollars, but the money can leave either a USD till or a
 * som account. Both are supported and they behave differently:
 *
 *   USD — the dollars come off the currency FIFO, so what they cost in KGS is
 *         already known and the rate is whatever those layers were bought at.
 *   KGS — som leaves directly, and the dollar rate used has to be supplied,
 *         because nothing else in the system knows what the carrier applied.
 *
 * Until Receipt recognises the freight cost (Module 3) there is no cargo
 * payable, so a payment made now simply leaves the carrier holding a deposit.
 */
@Injectable()
export class CargoPaymentsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.CPY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: CargoPaymentsRepository,
    private readonly companies: CargoCompaniesService,
    private readonly accounts: AccountsService,
    private readonly fifo: CurrencyFifoService,
    private readonly ledger: CargoLedgerService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateCargoPaymentDto, userId: string): Promise<documents> {
    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }

    await this.companies.findOne(dto.cargo_company_id);

    const account = await this.accounts.findOptional(dto.from_account);
    if (!account) {
      throw new NotFoundException('from_account does not exist');
    }
    if (!account.is_active) {
      throw new BadRequestException('The account must be active');
    }
    if (
      account.currency !== currency_code.USD &&
      account.currency !== currency_code.KGS
    ) {
      throw new BadRequestException(
        `A cargo payment leaves a USD or KGS account; ${account.name} holds ${account.currency} (§5.2)`,
      );
    }

    const rate = toOptionalDecimal(dto.rate, 'rate');
    if (account.currency === currency_code.KGS) {
      if (!rate || rate.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'rate is required when paying in KGS: the cargo debt is in USD and §5.2 requires the rate used to be recorded',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.CPY,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        cargoCompanyId: dto.cargo_company_id,
        fromAccount: dto.from_account,
        amount,
        currency: account.currency,
        // For a USD payment the real rate is only known once the layers are
        // consumed, so it is written when the document posts.
        rate: account.currency === currency_code.KGS ? rate! : null,
      });

      return document;
    });
  }

  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const payment = await this.repository.findByDocument(tx, document.id);
    if (!payment) {
      throw new NotFoundException(
        `Cargo payment body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      payment.from_account,
    );

    if (balance.lessThan(payment.amount)) {
      throw new ConflictException(
        `${account.name} holds ${balance.toFixed(2)} ${payment.currency}, ` +
          `which is not enough for ${payment.amount.toFixed(2)}` +
          (payment.currency === currency_code.USD
            ? '; buy currency first (CEX)'
            : ''),
      );
    }

    const paidInUsd = payment.currency === currency_code.USD;

    // What the payment settles, always in the carrier's currency.
    const usdSettled = paidInUsd
      ? payment.amount
      : roundMoney(payment.amount.dividedBy(payment.rate!));

    const open = await this.ledger.openDebt(tx, payment.cargo_company_id);
    const split = splitAgainstDebt(usdSettled, open);

    let kgsCost: Prisma.Decimal;
    let debtActualKgs: Prisma.Decimal;
    let prepayActualKgs: Prisma.Decimal;

    if (paidInUsd) {
      const debtConsumption = split.debtPart.greaterThan(0)
        ? await this.fifo.consumeCurrency(tx, {
            accountId: payment.from_account,
            amount: split.debtPart,
            documentId: document.id,
            accountName: account.name,
          })
        : null;
      const prepayConsumption = split.prepayPart.greaterThan(0)
        ? await this.fifo.consumeCurrency(tx, {
            accountId: payment.from_account,
            amount: split.prepayPart,
            documentId: document.id,
            accountName: account.name,
          })
        : null;

      debtActualKgs = debtConsumption?.kgsValue ?? ZERO;
      prepayActualKgs = prepayConsumption?.kgsValue ?? ZERO;
      kgsCost = debtActualKgs.plus(prepayActualKgs);
    } else {
      // Som leaves directly: the KGS cost is the amount itself, split in the
      // same proportion as the dollars it settles.
      kgsCost = payment.amount;
      debtActualKgs = usdSettled.isZero()
        ? ZERO
        : roundMoney(kgsCost.times(split.debtPart).dividedBy(usdSettled));
      prepayActualKgs = kgsCost.minus(debtActualKgs);
    }

    // §10.2, as for a supplier payment: what the debt was booked at less what
    // settling it actually cost. Zero while there is no cargo payable yet.
    const fxGainLoss = split.debtRecognisedKgs.minus(debtActualKgs);

    const rate = paidInUsd
      ? roundRate(kgsCost.dividedBy(payment.amount))
      : payment.rate!;

    await this.ledger.recordPayment(tx, {
      cargoCompanyId: payment.cargo_company_id,
      documentId: document.id,
      split,
      prepayActualKgs,
    });

    await this.accounts.postMovement(tx, {
      accountId: payment.from_account,
      documentId: document.id,
      amount: payment.amount.negated(),
      kgsValue: paidInUsd ? kgsCost.negated() : null,
      currentBalance: balance,
      accountName: account.name,
    });

    await this.repository.recordPosting(tx, document.id, {
      kgsValue: kgsCost,
      rate,
      fxGainLossKgs: fxGainLoss,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'cargo_payments',
        entityId: document.id,
        action: 'CARGO_PAYMENT_POSTED',
        newValue: {
          cargo_company_id: payment.cargo_company_id,
          paid: `${payment.amount.toFixed(2)} ${payment.currency}`,
          usd_settled: usdSettled.toFixed(2),
          rate: rate.toString(),
          rate_source: paidInUsd ? 'FACTUAL' : 'MANUAL',
          kgs_value: kgsCost.toFixed(2),
          debt_part_usd: split.debtPart.toFixed(2),
          prepay_part_usd: split.prepayPart.toFixed(2),
          fx_gain_loss_kgs: fxGainLoss.toFixed(2),
        },
      },
      tx,
    );
  }
}
