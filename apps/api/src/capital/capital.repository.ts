import { Injectable } from '@nestjs/common';
import { Prisma, capital_docs, capital_source, currency_code, investors } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvestorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: { name: string; phone: string | null }): Promise<investors> {
    return this.prisma.investors.create({ data });
  }

  findMany(includeInactive: boolean): Promise<investors[]> {
    return this.prisma.investors.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: { name: 'asc' },
    });
  }

  findById(id: string): Promise<investors | null> {
    return this.prisma.investors.findUnique({ where: { id } });
  }

  update(
    id: string,
    data: { name?: string; phone?: string; is_active?: boolean },
  ): Promise<investors> {
    return this.prisma.investors.update({ where: { id }, data });
  }
}

@Injectable()
export class CapitalRepository {
  insert(
    tx: Prisma.TransactionClient,
    data: {
      documentId: string;
      source: capital_source;
      investorId: string | null;
      accountId: string;
      amount: Prisma.Decimal;
      currency: currency_code;
      rate: Prisma.Decimal | null;
    },
  ): Promise<capital_docs> {
    return tx.capital_docs.create({
      data: {
        document_id: data.documentId,
        source: data.source,
        investor_id: data.investorId,
        account_id: data.accountId,
        amount: data.amount,
        currency: data.currency,
        rate: data.rate,
      },
    });
  }

  findByDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<capital_docs | null> {
    return tx.capital_docs.findUnique({ where: { document_id: documentId } });
  }
}
