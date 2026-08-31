import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4 } from './module4-harness';
import { cashFlowCategory } from '../src/reports/cash-flow-category';
import { salaryTotal } from '../src/salaries/salary-total';

const D = (v: string) => new Prisma.Decimal(v);

describe('Salary payment (Module 11, §25)', () => {
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
    await prisma.users.update({
      where: { id: ctx.staffId },
      data: { base_salary: '25000.00' },
    });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  async function fundTill(amount: string): Promise<void> {
    await documentFlow(app, ctx.ownerToken).createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: ctx.ownerCash,
      amount,
      comment: 'Тест: айлыкка акча',
    });
  }

  describe('The total (§25)', () => {
    it('is base + bonus − advance − deduction, and is never typed in', () => {
      expect(
        salaryTotal({
          base: D('25000.00'),
          bonus: D('4000.00'),
          advance: D('10000.00'),
          deduction: D('500.00'),
        }).toFixed(2),
      ).toBe('18500.00');
    });

    it('takes the employee’s own base salary when none is stated', async () => {
      await fundTill('100000.00');

      const { id } = await documentFlow(app, ctx.ownerToken).createAndConfirm(
        '/api/salaries',
        {
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          account_id: ctx.ownerCash,
        },
      );

      const { body } = await asOwner(http().get(`/api/salaries/${id}`)).expect(200);
      expect(body).toMatchObject({
        period: '2026-08',
        base_amount: '25000.00',
        bonus_amount: '0.00',
        total_paid: '25000.00',
      });
    });

    it('pays only the net, so an advance is not handed over twice', async () => {
      await fundTill('100000.00');

      const { id } = await documentFlow(app, ctx.ownerToken).createAndConfirm(
        '/api/salaries',
        {
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          bonus_amount: '4000.00',
          advance_amount: '10000.00',
          deduction: '500.00',
          account_id: ctx.ownerCash,
        },
      );

      const movements = await prisma.account_movements.findMany({
        where: { document_id: id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].amount.toFixed(2)).toBe('-18500.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'SALARY_PAID' },
      });
      expect(entry.new_value).toMatchObject({
        period: '2026-08',
        base_amount: '25000.00',
        bonus_amount: '4000.00',
        advance_amount: '10000.00',
        deduction: '500.00',
        total_paid: '18500.00',
        is_owner_withdrawal: false,
      });
    });

    it('refuses a month with nothing left to hand over', async () => {
      const { body } = await asOwner(http().post('/api/salaries'))
        .send({
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          advance_amount: '25000.00',
          account_id: ctx.ownerCash,
        })
        .expect(422);
      expect(body.code).toBe('NOTHING_TO_PAY');
      expect(body.total).toBe('0.00');
    });

    it('refuses a negative part', async () => {
      await asOwner(http().post('/api/salaries'))
        .send({
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          deduction: '-100.00',
          account_id: ctx.ownerCash,
        })
        .expect(400);
    });
  });

  describe('Paying it', () => {
    it('will not overdraw the till (§42.5)', async () => {
      await fundTill('1000.00');

      const { body: document } = await asOwner(http().post('/api/salaries'))
        .send({
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          account_id: ctx.ownerCash,
        })
        .expect(201);

      await asOwner(http().post(`/api/documents/${document.id}/confirm`)).expect(
        409,
      );
      const still = await prisma.documents.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(still.status).toBe('DRAFT');
    });

    it('is paid in som only', async () => {
      await asOwner(http().post('/api/salaries'))
        .send({
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          account_id: ctx.cnyAccount,
        })
        .expect(400);
    });

    it('is the OWNER’s alone to see and to make (§2)', async () => {
      await asStaff(http().get('/api/salaries')).expect(403);
      await asStaff(http().post('/api/salaries'))
        .send({
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 8,
          account_id: ctx.ownerCash,
        })
        .expect(403);
    });

    it('is an operating expense, never an owner withdrawal (§3.1.6)', () => {
      expect(cashFlowCategory('SLR')).toBe('OPERATING');
      expect(cashFlowCategory('WDW')).toBe('CAPITAL_FINANCING');
    });
  });

  describe('The period summary (§25)', () => {
    it('shows what each employee has already been paid for the month', async () => {
      await fundTill('100000.00');

      const before = await asOwner(
        http().get('/api/salaries/period/2026/8'),
      ).expect(200);
      expect(
        before.body.find((row: { employee_id: string }) => row.employee_id === ctx.staffId),
      ).toMatchObject({ base_salary: '25000.00', paid: '0.00', payments: 0 });

      await documentFlow(app, ctx.ownerToken).createAndConfirm('/api/salaries', {
        employee_id: ctx.staffId,
        period_year: 2026,
        period_month: 8,
        base_amount: '10000.00',
        account_id: ctx.ownerCash,
      });

      const after = await asOwner(
        http().get('/api/salaries/period/2026/8'),
      ).expect(200);
      expect(
        after.body.find((row: { employee_id: string }) => row.employee_id === ctx.staffId),
      ).toMatchObject({ paid: '10000.00', payments: 1 });

      // A second payment for the same month is allowed and adds up — §25 keeps
      // a history and says nothing about one payment per month.
      await documentFlow(app, ctx.ownerToken).createAndConfirm('/api/salaries', {
        employee_id: ctx.staffId,
        period_year: 2026,
        period_month: 8,
        base_amount: '15000.00',
        account_id: ctx.ownerCash,
      });

      const total = await asOwner(
        http().get('/api/salaries/period/2026/8'),
      ).expect(200);
      expect(
        total.body.find((row: { employee_id: string }) => row.employee_id === ctx.staffId),
      ).toMatchObject({ paid: '25000.00', payments: 2 });
    });

    it('counts confirmed payments only', async () => {
      await fundTill('100000.00');
      await asOwner(http().post('/api/salaries'))
        .send({
          employee_id: ctx.staffId,
          period_year: 2026,
          period_month: 9,
          account_id: ctx.ownerCash,
        })
        .expect(201);

      const { body } = await asOwner(
        http().get('/api/salaries/period/2026/9'),
      ).expect(200);
      expect(
        body.find((row: { employee_id: string }) => row.employee_id === ctx.staffId),
      ).toMatchObject({ paid: '0.00', payments: 0 });
    });
  });
});
