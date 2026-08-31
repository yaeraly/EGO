import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4 } from './module4-harness';
import { cashFlowCategory } from '../src/reports/cash-flow-category';

describe('Operating expenses (Module 10, §26)', () => {
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

  async function category(name: string, budget?: string): Promise<string> {
    const { body } = await asOwner(http().post('/api/expense-categories'))
      .send({ name, ...(budget ? { monthly_budget: budget } : {}) })
      .expect(201);
    return body.id as string;
  }

  /** Money in the till, so an expense has something to be paid from. */
  async function fundTill(amount: string): Promise<void> {
    await documentFlow(app, ctx.ownerToken).createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: ctx.ownerCash,
      amount,
      comment: 'Тест: кассага акча',
    });
  }

  describe('Categories (§26)', () => {
    it('are the OWNER’s to maintain, and everyone reads them (§2)', async () => {
      await category('Аренда', '30000.00');

      const { body } = await asStaff(http().get('/api/expense-categories')).expect(
        200,
      );
      expect(body).toEqual([
        expect.objectContaining({ name: 'Аренда', monthly_budget: '30000.00' }),
      ]);

      await asStaff(http().post('/api/expense-categories'))
        .send({ name: 'Интернет' })
        .expect(403);
    });

    it('refuses a duplicate name and a negative budget', async () => {
      await category('Интернет');
      await asOwner(http().post('/api/expense-categories'))
        .send({ name: 'Интернет' })
        .expect(409);
      await asOwner(http().post('/api/expense-categories'))
        .send({ name: 'Салык', monthly_budget: '-1.00' })
        .expect(400);
    });
  });

  describe('The expense itself (§26)', () => {
    it('takes the money out of the account it names', async () => {
      await fundTill('50000.00');
      const categoryId = await category('Аренда');

      const { id } = await documentFlow(app, ctx.ownerToken).createAndConfirm(
        '/api/expenses',
        {
          category_id: categoryId,
          account_id: ctx.ownerCash,
          amount: '30000.00',
          comment: 'Август айынын арендасы',
        },
      );

      const movements = await prisma.account_movements.findMany({
        where: { document_id: id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].amount.toFixed(2)).toBe('-30000.00');

      const { body } = await asOwner(
        http().get('/api/accounts/balances'),
      ).expect(200);
      const till = body.find(
        (account: { account_id: string }) => account.account_id === ctx.ownerCash,
      );
      expect(till.balance).toBe('20000.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'EXPENSE_CONFIRMED' },
      });
      expect(entry.new_value).toMatchObject({
        category: 'Аренда',
        amount: '30000.00',
      });
      expect(entry.reason).toBe('Август айынын арендасы');
    });

    it('will not overdraw the till (§42.5)', async () => {
      await fundTill('1000.00');
      const categoryId = await category('Канцтовар');

      const { body: document } = await asOwner(http().post('/api/expenses'))
        .send({
          category_id: categoryId,
          account_id: ctx.ownerCash,
          amount: '5000.00',
          comment: 'Кагаз жана калем',
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

    it('needs a comment, a real category and a positive amount', async () => {
      const categoryId = await category('Маркетинг');

      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: categoryId,
          account_id: ctx.ownerCash,
          amount: '100.00',
        })
        .expect(400);

      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: '00000000-0000-0000-0000-000000000000',
          account_id: ctx.ownerCash,
          amount: '100.00',
          comment: 'Жарнама',
        })
        .expect(404);

      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: categoryId,
          account_id: ctx.ownerCash,
          amount: '0.00',
          comment: 'Жарнама',
        })
        .expect(400);
    });

    it('is an operating flow, unlike an owner withdrawal (§3.1.5, §3.1.6)', () => {
      expect(cashFlowCategory('EXP')).toBe('OPERATING');
      expect(cashFlowCategory('WDW')).toBe('CAPITAL_FINANCING');
    });
  });

  describe('The monthly ceiling (§26)', () => {
    it('reports what was spent against the budget, and never blocks', async () => {
      await fundTill('100000.00');
      const categoryId = await category('Аренда', '30000.00');
      const flow = documentFlow(app, ctx.ownerToken);

      await flow.createAndConfirm('/api/expenses', {
        category_id: categoryId,
        account_id: ctx.ownerCash,
        amount: '20000.00',
        comment: 'Биринчи жарымы',
      });

      const half = await asOwner(http().get('/api/expenses/monthly')).expect(200);
      expect(half.body).toEqual([
        expect.objectContaining({
          name: 'Аренда',
          monthly_budget: '30000.00',
          spent: '20000.00',
          remaining: '10000.00',
          over_budget: false,
        }),
      ]);

      // Over the ceiling: recorded, flagged, and still paid.
      await flow.createAndConfirm('/api/expenses', {
        category_id: categoryId,
        account_id: ctx.ownerCash,
        amount: '15000.00',
        comment: 'Экинчи жарымы',
      });

      const over = await asOwner(http().get('/api/expenses/monthly')).expect(200);
      expect(over.body[0]).toMatchObject({
        spent: '35000.00',
        remaining: '-5000.00',
        over_budget: true,
      });
    });

    it('counts confirmed documents only — a draft is a plan, not a cost', async () => {
      await fundTill('50000.00');
      const categoryId = await category('Коммуналдык', '10000.00');

      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: categoryId,
          account_id: ctx.ownerCash,
          amount: '9000.00',
          comment: 'Жарык',
        })
        .expect(201);

      const { body } = await asOwner(http().get('/api/expenses/monthly')).expect(200);
      expect(body[0]).toMatchObject({ spent: '0.00', over_budget: false });
    });

    it('says nothing about a category with no ceiling', async () => {
      const categoryId = await category('Башка чыгымдар');
      const { body } = await asOwner(http().get('/api/expenses/monthly')).expect(200);
      expect(body).toEqual([
        expect.objectContaining({
          category_id: categoryId,
          monthly_budget: null,
          remaining: null,
          over_budget: false,
        }),
      ]);
    });
  });
});
