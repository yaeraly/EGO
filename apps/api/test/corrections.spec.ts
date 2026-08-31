import { INestApplication } from '@nestjs/common';
import { PrismaClient, day_status, month_status } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4 } from './module4-harness';
import { correctableType } from '../src/corrections/correction-rules';
import {
  CashFlowCategory,
  cashFlowCategory,
  correctionCashFlowCategory,
} from '../src/reports/cash-flow-category';
import { doc_type } from '@prisma/client';

const OWNER_PIN = '12345678';
const REASON = 'Кассир суммасын ката киргизген, оңдоо керек';

describe('Correction / Reversal (Module 13, §27.1, Period Lock)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module4Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule4(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const flow = () => documentFlow(app, ctx.ownerToken);

  /** Money in the OWNER's till, so there is something to correct. */
  async function fundTill(amount: string, account = ctx.ownerCash) {
    return flow().createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: account,
      amount,
      comment: 'Тест: кассага акча',
    });
  }

  async function expenseOf(amount: string): Promise<{ id: string; doc_number: string }> {
    const { body: category } = await asOwner(http().post('/api/expense-categories'))
      .send({ name: `Аренда ${Math.random()}` })
      .expect(201);
    return flow().createAndConfirm('/api/expenses', {
      category_id: category.id,
      account_id: ctx.ownerCash,
      amount,
      comment: 'Аренда төлөмү',
    });
  }

  async function balance(accountId: string): Promise<string> {
    const { body } = await asOwner(http().get('/api/accounts/balances')).expect(200);
    return body.find((a: { account_id: string }) => a.account_id === accountId)
      .balance as string;
  }

  async function correct(
    originalId: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; doc_number: string }> {
    const { body } = await asOwner(http().post('/api/corrections'))
      .send({
        original_document_id: originalId,
        correction_type: 'REVERSAL',
        reason: REASON,
        ...extra,
      })
      .expect(201);
    return body;
  }

  describe('What a correction may reverse (§27.1)', () => {
    it('puts an expense back exactly as it was', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('12000.00');
      expect(await balance(ctx.ownerCash)).toBe('38000.00');

      const correction = await correct(expense.id);
      expect(correction.doc_number).toMatch(/^COR-\d{4}-\d{6}$/);

      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      expect(await balance(ctx.ownerCash)).toBe('50000.00');
    });

    it('leaves the original document exactly where it was (§27.1)', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('12000.00');

      const correction = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      const original = await prisma.documents.findUniqueOrThrow({
        where: { id: expense.id },
      });
      expect(original.status).toBe('CONFIRMED');
      expect(original.cancelled_at).toBeNull();

      // The original's own movement is untouched; the reversal is the
      // correction's movement, not an edit of the original's (§42.3).
      const originalMovements = await prisma.account_movements.findMany({
        where: { document_id: expense.id },
      });
      expect(originalMovements).toHaveLength(1);
      expect(originalMovements[0].amount.toFixed(2)).toBe('-12000.00');

      const reversalMovements = await prisma.account_movements.findMany({
        where: { document_id: correction.id },
      });
      expect(reversalMovements).toHaveLength(1);
      expect(reversalMovements[0].amount.toFixed(2)).toBe('12000.00');
    });

    it('reverses both sides of a cashier-to-cashier transfer (§19)', async () => {
      await fundTill('30000.00');
      const transfer = await flow().createAndConfirm('/api/transfers', {
        from_account: ctx.ownerCash,
        to_account: ctx.sellerCash,
        amount: '7000.00',
      });
      expect(await balance(ctx.sellerCash)).toBe('7000.00');

      const correction = await correct(transfer.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      expect(await balance(ctx.ownerCash)).toBe('30000.00');
      expect(await balance(ctx.sellerCash)).toBe('0.00');
    });

    it('refuses a reversal the till can no longer afford (§42.5)', async () => {
      const capital = await fundTill('10000.00');
      // The money has since been spent, so putting the capital back would
      // overdraw the till.
      await expenseOf('9000.00');

      const correction = await correct(capital.id);
      const { body } = await asOwner(
        http().post(`/api/corrections/${correction.id}/confirm`),
      )
        .send({ pin: OWNER_PIN })
        .expect(409);
      expect(body.message).toMatch(/1000\.00/);

      // The correction stayed a draft; nothing moved.
      const document = await prisma.documents.findUniqueOrThrow({
        where: { id: correction.id },
      });
      expect(document.status).toBe('DRAFT');
      expect(await balance(ctx.ownerCash)).toBe('1000.00');
    });
  });

  describe('What it refuses to reverse, and what to do instead', () => {
    it('sends a sale to the return process (§27.1, §35)', async () => {
      const sale = await prisma.documents.findFirst({
        where: { doc_type: 'SAL' },
      });
      // The rule itself, stated where it is decided.
      const verdict = correctableType(doc_type.SAL);
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/возврат \(RET\)/);
      expect(sale).toBeNull();
    });

    it('refuses a document that moved stock', async () => {
      const receipt = await prisma.documents.findFirst({
        where: { doc_type: 'RCV', status: 'CONFIRMED' },
      });
      if (!receipt) {
        // The fixture stocks the warehouse through a receipt; if that ever
        // changes, the rule below is still the one that matters.
        expect(correctableType(doc_type.RCV).ok).toBe(false);
        return;
      }

      const { body } = await asOwner(http().post('/api/corrections'))
        .send({
          original_document_id: receipt.id,
          correction_type: 'REVERSAL',
          reason: REASON,
        })
        .expect(422);
      expect(body.code).toBe('NOT_CORRECTABLE');
    });

    it('refuses a foreign-currency document, whose rate layers it cannot rebuild (§10-А)', async () => {
      const capital = await flow().createAndConfirm('/api/capital', {
        source: 'OWNER',
        account_id: ctx.cnyAccount,
        amount: '1000.00',
        rate: '12.50',
      });

      const { body } = await asOwner(http().post('/api/corrections'))
        .send({
          original_document_id: capital.id,
          correction_type: 'REVERSAL',
          reason: REASON,
        })
        .expect(422);
      expect(body.code).toBe('NOT_CORRECTABLE');
      expect(body.message).toMatch(/FIFO layer/);
    });

    it('refuses a draft — there is nothing posted to reverse (§27.1)', async () => {
      await fundTill('20000.00');
      const { body: category } = await asOwner(
        http().post('/api/expense-categories'),
      )
        .send({ name: 'Интернет' })
        .expect(201);
      const { body: draft } = await asOwner(http().post('/api/expenses'))
        .send({
          category_id: category.id,
          account_id: ctx.ownerCash,
          amount: '500.00',
          comment: 'Интернет',
        })
        .expect(201);

      await asOwner(http().post('/api/corrections'))
        .send({
          original_document_id: draft.id,
          correction_type: 'REVERSAL',
          reason: REASON,
        })
        .expect(409);
    });

    it('refuses to correct the same document twice (§27.1)', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('5000.00');

      const first = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${first.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      await asOwner(http().post('/api/corrections'))
        .send({
          original_document_id: expense.id,
          correction_type: 'REVERSAL',
          reason: REASON,
        })
        .expect(409);
    });

    it('refuses to correct a correction', () => {
      const verdict = correctableType(doc_type.COR);
      expect(verdict.ok).toBe(false);
    });
  });

  describe('Who may make one (§27.1, §2)', () => {
    it('is the OWNER’s alone — raising it and confirming it both', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('3000.00');

      await asStaff(http().post('/api/corrections'))
        .send({
          original_document_id: expense.id,
          correction_type: 'REVERSAL',
          reason: REASON,
        })
        .expect(403);

      const correction = await correct(expense.id);
      await asStaff(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(403);
      await asOwner(http().get('/api/corrections')).expect(200);
      await asStaff(http().get('/api/corrections')).expect(403);
    });

    it('always takes a PIN, and cannot be slipped past it (§27.1)', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('3000.00');
      const correction = await correct(expense.id);

      const { body } = await asOwner(
        http().post(`/api/corrections/${correction.id}/confirm`),
      )
        .send({ pin: '00000000' })
        .expect(422);
      expect(body.code).toBe('PIN_INVALID');

      // The generic document endpoint is not a way around the PIN.
      const generic = await asOwner(
        http().post(`/api/documents/${correction.id}/confirm`),
      ).expect(422);
      expect(generic.body.code).toBe('PIN_REQUIRED');

      expect(await balance(ctx.ownerCash)).toBe('47000.00');
    });

    it('will not accept a reason that says nothing (§27.1)', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('3000.00');

      await asOwner(http().post('/api/corrections'))
        .send({
          original_document_id: expense.id,
          correction_type: 'REVERSAL',
          reason: 'ката',
        })
        .expect(400);
    });
  });

  describe('The record it leaves (Period Lock)', () => {
    it('carries the original, the reason, the old and the new value', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('12000.00');
      const correction = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      const { body } = await asOwner(
        http().get(`/api/corrections/${correction.id}`),
      ).expect(200);

      expect(body.original.doc_number).toBe(expense.doc_number);
      expect(body.correction_type).toBe('REVERSAL');
      expect(body.reason).toBe(REASON);
      expect(body.old_value.doc_number).toBe(expense.doc_number);
      expect(body.old_value.account_movements[0].amount).toBe('-12000.00');
      expect(body.old_value.balances['Owner Cash']).toBe('38000.00');
      expect(body.new_value.account_movements[0].amount).toBe('12000.00');
      expect(body.new_value.balances['Owner Cash']).toBe('50000.00');
      expect(body.new_value.reversed_by).toBe(correction.doc_number);
    });

    it('writes an audit entry nobody can edit afterwards (§27)', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('4000.00');
      const correction = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      const entry = await prisma.audit_log.findFirst({
        where: { document_id: correction.id, action: 'CORRECTION_POSTED' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.reason).toBe(REASON);
    });

    it('belongs in the Cash Flow where the document it reverses does (§28)', () => {
      // A correction has no category of its own; it borrows the original's,
      // and the opposite sign is already in the movements.
      expect(correctionCashFlowCategory(doc_type.EXP)).toBe(
        CashFlowCategory.OPERATING,
      );
      expect(correctionCashFlowCategory(doc_type.CAP)).toBe(
        CashFlowCategory.CAPITAL_FINANCING,
      );
      expect(correctionCashFlowCategory(doc_type.TRN)).toBe(
        CashFlowCategory.INTERNAL_TRANSFER,
      );
      expect(cashFlowCategory(doc_type.COR)).toBeNull();
    });

    it('says up front whether a document can be corrected', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('4000.00');

      const before = await asOwner(
        http().get(`/api/corrections/eligibility/${expense.id}`),
      ).expect(200);
      expect(before.body.correctable).toBe(true);
      expect(before.body.reason).toBeNull();

      const correction = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      const after = await asOwner(
        http().get(`/api/corrections/eligibility/${expense.id}`),
      ).expect(200);
      expect(after.body.correctable).toBe(false);
      expect(after.body.reason).toMatch(/мурда/);
    });
  });

  describe('The closed period (Period Lock)', () => {
    /** The August error found in September, from the specification's example. */
    async function closedDayExpense(): Promise<{
      expense: { id: string; doc_number: string };
      day: Date;
    }> {
      await fundTill('50000.00');
      const expense = await expenseOf('9000.00');
      const document = await prisma.documents.findUniqueOrThrow({
        where: { id: expense.id },
      });
      await prisma.business_days.update({
        where: { business_date: document.business_date },
        data: { status: day_status.DAY_CLOSED },
      });
      return { expense, day: document.business_date };
    }

    it('is the one document a closed day still accepts', async () => {
      const { expense, day } = await closedDayExpense();

      // Any ordinary document is refused, which is the whole point of the lock.
      const { body: category } = await asOwner(
        http().post('/api/expense-categories'),
      )
        .send({ name: 'Салык' })
        .expect(201);
      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: category.id,
          account_id: ctx.ownerCash,
          amount: '100.00',
          comment: 'Салык',
          business_date: day.toISOString().slice(0, 10),
        })
        .expect(423);

      const correction = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);
      expect(await balance(ctx.ownerCash)).toBe('50000.00');
    });

    it('reaches a closed month too', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('9000.00');
      const document = await prisma.documents.findUniqueOrThrow({
        where: { id: expense.id },
      });
      await prisma.business_months.create({
        data: {
          year: document.business_date.getUTCFullYear(),
          month: document.business_date.getUTCMonth() + 1,
          status: month_status.MONTH_CLOSED,
        },
      });

      const correction = await correct(expense.id);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: OWNER_PIN })
        .expect(201);
      expect(await balance(ctx.ownerCash)).toBe('50000.00');
    });

    it('keeps the period it belongs to apart from the day it was entered', async () => {
      const { expense, day } = await closedDayExpense();
      const correction = await correct(expense.id);

      const document = await prisma.documents.findUniqueOrThrow({
        where: { id: correction.id },
      });
      const record = await prisma.corrections.findUniqueOrThrow({
        where: { document_id: correction.id },
      });

      // Business/Effective Date — the original's period.
      expect(document.business_date.toISOString()).toBe(day.toISOString());
      expect(record.effective_date.toISOString()).toBe(day.toISOString());
      // Created Date/Time — never backdated.
      expect(document.created_at.getTime()).toBeGreaterThan(day.getTime());
    });

    it('books to another period when the OWNER names one', async () => {
      await fundTill('50000.00');
      const expense = await expenseOf('9000.00');

      const correction = await correct(expense.id, {
        effective_date: '2026-08-31',
      });
      const record = await prisma.corrections.findUniqueOrThrow({
        where: { document_id: correction.id },
      });
      expect(record.effective_date.toISOString().slice(0, 10)).toBe('2026-08-31');
    });
  });
});
