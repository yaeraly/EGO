import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, doc_type, documents } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toOptionalDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateSalaryDto } from './dto/salary.dto';
import { isPayable, salaryTotal } from './salary-total';

const ZERO = new Prisma.Decimal(0);

export type SalaryFull = Prisma.salary_paymentsGetPayload<{
  include: { users: true; payment_accounts: true; documents: true };
}>;

/**
 * Salary payment (SLR) — §25.
 *
 * The OWNER sets each person's base salary on their user record; this is the
 * document that pays it. §25 keeps the parts apart — base, bonus, advance,
 * deduction — because the total is the only thing handed over and the parts
 * are what explain it.
 *
 * §3.1.6 is the rule that gives this module its shape: a salary is an
 * operating expense and an owner's withdrawal is not. They are separate
 * documents, separate cash-flow categories, and nothing here can be used for
 * the other.
 */
@Injectable()
export class SalariesService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.SLR;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateSalaryDto, userId: string): Promise<documents> {
    const employee = await this.users.findOne(dto.employee_id);

    const account = await this.accounts.findOne(dto.account_id);
    if (!account.is_active) {
      throw new BadRequestException(`${account.name} эсеби активдүү эмес`);
    }
    if (account.currency !== 'KGS') {
      throw new BadRequestException(
        `${account.name} — ${account.currency} эсеби; айлык сом менен төлөнөт`,
      );
    }

    // §25 — the employee's own salary is the default; a month may still be
    // paid at a different figure, and then it is stated.
    const stored = await this.prisma.users.findUniqueOrThrow({
      where: { id: employee.id },
      select: { base_salary: true },
    });

    const parts = {
      base: toOptionalDecimal(dto.base_amount, 'base_amount') ?? stored.base_salary,
      bonus: toOptionalDecimal(dto.bonus_amount, 'bonus_amount') ?? ZERO,
      advance: toOptionalDecimal(dto.advance_amount, 'advance_amount') ?? ZERO,
      deduction: toOptionalDecimal(dto.deduction, 'deduction') ?? ZERO,
    };

    for (const [name, value] of Object.entries(parts)) {
      if (value.isNegative()) {
        throw new BadRequestException(`${name} терс болбойт`);
      }
    }

    const total = salaryTotal(parts);
    if (!isPayable(total)) {
      throw new UnprocessableEntityException({
        message:
          `Төлөнө турган сумма ${total.toFixed(2)} — аванс жана кармоо эсептелгенден кийин ` +
          'төлөй турган нерсе калган жок (§25)',
        code: 'NOTHING_TO_PAY',
        total: total.toFixed(2),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.SLR,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await tx.salary_payments.create({
        data: {
          document_id: document.id,
          employee_id: employee.id,
          period_year: dto.period_year,
          period_month: dto.period_month,
          base_amount: parts.base,
          bonus_amount: parts.bonus,
          advance_amount: parts.advance,
          deduction: parts.deduction,
          total_paid: total,
          account_id: dto.account_id,
        },
      });

      return document;
    });
  }

  /**
   * Paying it: the total leaves the account, and only the total.
   *
   * The advance already left the till by whatever document handed it over, so
   * posting the gross here would pay it twice.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const salary = await tx.salary_payments.findUnique({
      where: { document_id: document.id },
      include: { users: { select: { full_name: true } } },
    });
    if (!salary) {
      throw new NotFoundException(
        `Salary body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      salary.account_id,
    );
    await this.accounts.postMovement(tx, {
      accountId: salary.account_id,
      documentId: document.id,
      amount: salary.total_paid.negated(),
      kgsValue: null,
      currentBalance: balance,
      accountName: account.name,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'salary_payments',
        entityId: document.id,
        action: 'SALARY_PAID',
        newValue: {
          employee_id: salary.employee_id,
          employee: salary.users.full_name,
          period: `${salary.period_year}-${String(salary.period_month).padStart(2, '0')}`,
          base_amount: salary.base_amount.toFixed(2),
          bonus_amount: salary.bonus_amount.toFixed(2),
          advance_amount: salary.advance_amount.toFixed(2),
          deduction: salary.deduction.toFixed(2),
          total_paid: salary.total_paid.toFixed(2),
          account_id: salary.account_id,
          // §3.1.6 — a salary is an operating expense, never an owner draw.
          is_owner_withdrawal: false,
        },
        reason: document.comment,
      },
      tx,
    );
  }

  findMany(filter: {
    employeeId?: string;
    year?: number;
    month?: number;
  }): Promise<SalaryFull[]> {
    return this.prisma.salary_payments.findMany({
      where: {
        ...(filter.employeeId ? { employee_id: filter.employeeId } : {}),
        ...(filter.year ? { period_year: filter.year } : {}),
        ...(filter.month ? { period_month: filter.month } : {}),
      },
      include: { users: true, payment_accounts: true, documents: true },
      orderBy: [
        { period_year: 'desc' },
        { period_month: 'desc' },
        { documents: { created_at: 'desc' } },
      ],
      take: 200,
    });
  }

  findOne(id: string, db: Db = this.prisma): Promise<SalaryFull> {
    return this.requireSalary(db, id);
  }

  /**
   * What each employee has already been paid for a period (§25).
   *
   * §25 asks for the history to be kept and says nothing about one payment a
   * month, so a second one is not refused — an advance settled early and the
   * rest later is an ordinary way to pay. What the screen gets instead is the
   * figure that makes a double payment obvious before it happens.
   */
  async periodSummary(
    year: number,
    month: number,
  ): Promise<
    {
      employee_id: string;
      full_name: string;
      base_salary: string;
      paid: string;
      payments: number;
    }[]
  > {
    const employees = await this.prisma.users.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, full_name: true, base_salary: true },
      orderBy: { full_name: 'asc' },
    });

    const rows = await this.prisma.$queryRaw<
      { employee_id: string; paid: Prisma.Decimal; payments: bigint }[]
    >`
      SELECT s.employee_id, SUM(s.total_paid) AS paid, COUNT(*) AS payments
      FROM salary_payments s
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED'
        AND s.period_year = ${year}
        AND s.period_month = ${month}
      GROUP BY s.employee_id
    `;
    const paidBy = new Map(rows.map((row) => [row.employee_id, row]));

    return employees.map((employee) => {
      const row = paidBy.get(employee.id);
      return {
        employee_id: employee.id,
        full_name: employee.full_name,
        base_salary: employee.base_salary.toFixed(2),
        paid: (row?.paid ?? ZERO).toFixed(2),
        payments: Number(row?.payments ?? 0),
      };
    });
  }

  private async requireSalary(db: Db, id: string): Promise<SalaryFull> {
    const salary = await db.salary_payments.findUnique({
      where: { document_id: id },
      include: { users: true, payment_accounts: true, documents: true },
    });
    if (!salary) {
      throw new NotFoundException('Айлык документи табылган жок');
    }
    return salary;
  }
}
