import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';

const OWNER_PIN = '12345678';
const STAFF_PIN = '87654321';

describe('Day Close and Period Lock (Module 14, §20, Period Lock)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module4Context;
  let today: string;

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
    const { body } = await asOwner(http().get('/api/day-close/pre-check')).expect(
      200,
    );
    today = body.business_date;
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  /** A cash sale by the salesperson, so their till has something in it. */
  async function cashSale(amount: string, price = amount): Promise<string> {
    await stockLayer(app, prisma, ctx, {
      qty: '1.00',
      unitCost: '1000.0000',
    });
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.walkInId,
        items: [
          { product_id: ctx.productIds[0], qty: '1.00', final_price: price },
        ],
        payments: [{ account_id: ctx.sellerCash, amount }],
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
      .send({ pin: STAFF_PIN })
      .expect(201);
    return draft.id as string;
  }

  /** Everything unfinished, resolved the way Period Lock says to resolve it. */
  async function clearDrafts(): Promise<void> {
    const drafts = await prisma.documents.findMany({
      where: { status: 'DRAFT' },
    });
    for (const draft of drafts) {
      await asOwner(http().post(`/api/documents/${draft.id}/cancel`))
        .send({ reason: 'Тест: бүтпөгөн документ жокко чыгарылды' })
        .expect(201);
    }
  }

  const handOver = (body: Record<string, unknown> = {}) =>
    asStaff(http().post('/api/cash-handovers')).send({
      from_account: ctx.sellerCash,
      to_account: ctx.kgsAccount,
      ...body,
    });

  describe('The salesperson’s own day (§20)', () => {
    it('shows what the system says they took', async () => {
      await cashSale('9000.00');

      const { body } = await asStaff(
        http().get('/api/cash-handovers/summary'),
      ).expect(200);

      expect(body.sales_count).toBe(1);
      expect(body.sales_total).toBe('9000.00');
      expect(body.credit_total).toBe('0.00');
      expect(body.cash_expected).toBe('9000.00');
      expect(body.accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            account_id: ctx.sellerCash,
            received: '9000.00',
            balance: '9000.00',
          }),
        ]),
      );
      expect(body.handover).toBeNull();
    });

    it('counts a credit sale as debt, not as cash', async () => {
      await stockLayer(app, prisma, ctx, { qty: '1.00', unitCost: '1000.0000' });
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '50000.00' },
      });
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', final_price: '8000.00' },
          ],
          debt_due_date: '2026-12-31',
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
        .send({ pin: STAFF_PIN })
        .expect(201);

      const { body } = await asStaff(
        http().get('/api/cash-handovers/summary'),
      ).expect(200);
      expect(body.sales_total).toBe('8000.00');
      expect(body.credit_total).toBe('8000.00');
      expect(body.cash_expected).toBe('0.00');
    });

    it('is each person’s own; the OWNER may look at anyone’s (§2)', async () => {
      await cashSale('5000.00');

      const own = await asStaff(http().get('/api/cash-handovers/summary'))
        .query({ user_id: ctx.ownerId })
        .expect(200);
      // A salesperson asking after someone else still gets their own.
      expect(own.body.user_id).toBe(ctx.staffId);

      const seen = await asOwner(http().get('/api/cash-handovers/summary'))
        .query({ user_id: ctx.staffId })
        .expect(200);
      expect(seen.body.user_id).toBe(ctx.staffId);
      expect(seen.body.cash_expected).toBe('5000.00');
    });
  });

  describe('Handing the till over (§20, §19)', () => {
    it('moves the money by TRN and records the comparison', async () => {
      await cashSale('9000.00');

      const { body: handover } = await handOver({
        actual_amount: '9000.00',
      }).expect(201);

      expect(handover.expected_amount).toBe('9000.00');
      expect(handover.actual_amount).toBe('9000.00');
      expect(handover.difference).toBe('0.00');
      expect(handover.transfer_doc_id).not.toBeNull();

      const transfer = await prisma.documents.findUniqueOrThrow({
        where: { id: handover.transfer_doc_id },
      });
      expect(transfer.doc_type).toBe('TRN');
      expect(transfer.status).toBe('CONFIRMED');

      const { body: accounts } = await asOwner(
        http().get('/api/accounts/balances'),
      ).expect(200);
      const seller = accounts.find(
        (a: { account_id: string }) => a.account_id === ctx.sellerCash,
      );
      const central = accounts.find(
        (a: { account_id: string }) => a.account_id === ctx.kgsAccount,
      );
      expect(seller.balance).toBe('0.00');
      expect(central.balance).toBe('9000.00');
    });

    it('moves the day to CASH_HANDED once nobody is still holding money', async () => {
      await cashSale('9000.00');

      const before = await asOwner(http().get('/api/day-close/pre-check')).expect(
        200,
      );
      expect(before.body.status).toBe('OPEN');
      expect(before.body.pending_handovers).toEqual([
        expect.objectContaining({ user_id: ctx.staffId }),
      ]);

      await handOver({ actual_amount: '9000.00' }).expect(201);

      const after = await asOwner(http().get('/api/day-close/pre-check')).expect(
        200,
      );
      expect(after.body.status).toBe('CASH_HANDED');
      expect(after.body.pending_handovers).toEqual([]);
    });

    it('refuses a difference with no reason, and records one that has (§20)', async () => {
      await cashSale('9000.00');

      const refused = await handOver({ actual_amount: '8800.00' }).expect(400);
      expect(refused.body.code).toBe('DIFFERENCE_REASON_REQUIRED');

      const { body: handover } = await handOver({
        actual_amount: '8800.00',
        difference_reason: '200 сом кем чыкты, себеби белгисиз',
      }).expect(201);

      expect(handover.difference).toBe('-200.00');
      expect(handover.difference_reason).toMatch(/кем чыкты/);

      // The shortfall is documented, not written off: the till still shows it.
      const { body: accounts } = await asOwner(
        http().get('/api/accounts/balances'),
      ).expect(200);
      const seller = accounts.find(
        (a: { account_id: string }) => a.account_id === ctx.sellerCash,
      );
      expect(seller.balance).toBe('200.00');
    });

    it('hands nothing over when there is nothing, and still records the day', async () => {
      // A confirmed document with no cash: the seller worked, the till is empty.
      await stockLayer(app, prisma, ctx, { qty: '1.00', unitCost: '1000.0000' });
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '50000.00' },
      });
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', final_price: '8000.00' },
          ],
          debt_due_date: '2026-12-31',
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
        .send({ pin: STAFF_PIN })
        .expect(201);

      const { body: handover } = await handOver({
        actual_amount: '0.00',
      }).expect(201);
      expect(handover.transfer_doc_id).toBeNull();
      expect(handover.difference).toBe('0.00');
    });

    it('is once a day, from your own till, to a central account (§19)', async () => {
      await cashSale('9000.00');
      await handOver({ actual_amount: '9000.00' }).expect(201);
      await handOver({ actual_amount: '0.00' }).expect(409);

      // Someone else's till is not yours to hand over.
      await asOwner(http().post('/api/cash-handovers'))
        .send({
          from_account: ctx.sellerCash,
          to_account: ctx.kgsAccount,
          actual_amount: '0.00',
        })
        .expect(400);

      // Nor does the money go to another salesperson.
      await asStaff(http().post('/api/cash-handovers'))
        .send({
          from_account: ctx.sellerCash,
          to_account: ctx.sellerBank,
          actual_amount: '0.00',
        })
        .expect(400);
    });
  });

  describe('Day Close Pre-check (Period Lock)', () => {
    it('names the unfinished documents rather than counting them', async () => {
      await cashSale('9000.00');
      await stockLayer(app, prisma, ctx, { qty: '1.00', unitCost: '1000.0000' });
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.walkInId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', final_price: '100.00' },
          ],
        })
        .expect(201);

      const { body } = await asOwner(http().get('/api/day-close/pre-check')).expect(
        200,
      );
      expect(body.can_close).toBe(false);
      expect(body.unresolved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            document_id: draft.id,
            doc_number: draft.doc_number,
            kind: 'DOCUMENT_DRAFT',
          }),
        ]),
      );
    });

    it('is readable by the salesperson whose work it names (§20)', async () => {
      await cashSale('9000.00');
      await asStaff(http().get('/api/day-close/pre-check')).expect(200);
    });

    it('blocks the close while a draft stands — the OWNER included', async () => {
      await cashSale('9000.00');
      await handOver({ actual_amount: '9000.00' }).expect(201);

      const blocked = await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(422);
      expect(blocked.body.code).toBe('DAY_CLOSE_BLOCKED');
      expect(blocked.body.unresolved.length).toBeGreaterThan(0);

      const day = await prisma.business_days.findUniqueOrThrow({
        where: { business_date: new Date(`${today}T00:00:00.000Z`) },
      });
      expect(day.status).not.toBe('DAY_CLOSED');
    });

    it('blocks the close while a till has not been handed over', async () => {
      await cashSale('9000.00');
      await clearDrafts();

      const blocked = await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(422);
      expect(blocked.body.pending_handovers).toEqual([
        expect.objectContaining({ user_id: ctx.staffId }),
      ]);
    });
  });

  describe('Closing the day (§20)', () => {
    async function readyToClose(): Promise<void> {
      await cashSale('9000.00');
      await handOver({ actual_amount: '9000.00' }).expect(201);
      await clearDrafts();
    }

    it('closes once nothing is unfinished and every till is in', async () => {
      await readyToClose();

      const check = await asOwner(http().get('/api/day-close/pre-check')).expect(
        200,
      );
      expect(check.body.can_close).toBe(true);

      const { body } = await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(201);
      expect(body.status).toBe('DAY_CLOSED');
      expect(body.closed_by).toBe(ctx.ownerId);
      expect(body.closed_at).not.toBeNull();

      const entry = await prisma.audit_log.findFirst({
        where: { action: 'DAY_CLOSED' },
      });
      expect(entry).not.toBeNull();
    });

    it('is the OWNER’s, and always takes a PIN (Security §3)', async () => {
      await readyToClose();

      await asStaff(http().post('/api/day-close/close'))
        .send({ pin: STAFF_PIN })
        .expect(403);

      const wrongPin = await asOwner(http().post('/api/day-close/close'))
        .send({ pin: '00000000' })
        .expect(422);
      expect(wrongPin.body.code).toBe('PIN_INVALID');
    });

    it('seals the day: no ordinary document, and no second close', async () => {
      await readyToClose();
      await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(201);

      const { body: category } = await asOwner(
        http().post('/api/expense-categories'),
      )
        .send({ name: 'Аренда' })
        .expect(201);
      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: category.id,
          account_id: ctx.kgsAccount,
          amount: '100.00',
          comment: 'Аренда',
          business_date: today,
        })
        .expect(423);

      await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(409);
    });

    it('accepts no handover into a closed day (§20)', async () => {
      await cashSale('9000.00');
      await handOver({ actual_amount: '9000.00' }).expect(201);
      await clearDrafts();
      await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(201);

      await prisma.daily_cash_handovers.deleteMany({});
      await handOver({ actual_amount: '0.00' }).expect(423);
    });
  });

  describe('Closing and reopening the month (Period Lock)', () => {
    const year = () => Number(today.slice(0, 4));
    const month = () => Number(today.slice(5, 7));
    /**
     * A day of the same month that is not today, so the month lock is what is
     * being tested rather than today's own day lock.
     */
    const otherDay = () =>
      `${today.slice(0, 8)}${today.slice(8) === '28' ? '27' : '28'}`;

    async function closeToday(): Promise<void> {
      await cashSale('9000.00');
      await handOver({ actual_amount: '9000.00' }).expect(201);
      await clearDrafts();
      await asOwner(http().post('/api/day-close/close'))
        .send({ pin: OWNER_PIN })
        .expect(201);
    }

    it('waits for every day of the month to be closed', async () => {
      await cashSale('9000.00');

      const check = await asOwner(
        http().get(`/api/month-close/${year()}/${month()}`),
      ).expect(200);
      expect(check.body.can_close).toBe(false);
      expect(check.body.open_days).toEqual([
        expect.objectContaining({ business_date: today }),
      ]);

      const blocked = await asOwner(
        http().post(`/api/month-close/${year()}/${month()}/close`),
      )
        .send({ pin: OWNER_PIN })
        .expect(422);
      expect(blocked.body.code).toBe('MONTH_CLOSE_BLOCKED');
    });

    it('closes, and then the whole month refuses ordinary documents', async () => {
      await closeToday();

      const { body } = await asOwner(
        http().post(`/api/month-close/${year()}/${month()}/close`),
      )
        .send({ pin: OWNER_PIN })
        .expect(201);
      expect(body.status).toBe('MONTH_CLOSED');
      expect(body.closed_by).toBe(ctx.ownerId);

      const { body: category } = await asOwner(
        http().post('/api/expense-categories'),
      )
        .send({ name: 'Интернет' })
        .expect(201);
      // Another day of the same month, never used and never closed: what
      // refuses it is the month, not the day.
      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: category.id,
          account_id: ctx.kgsAccount,
          amount: '100.00',
          comment: 'Интернет',
          business_date: otherDay(),
        })
        .expect(423);
    });

    it('reopens only with the OWNER’s PIN and a reason, and says so in the log', async () => {
      await closeToday();
      await asOwner(http().post(`/api/month-close/${year()}/${month()}/close`))
        .send({ pin: OWNER_PIN })
        .expect(201);

      await asStaff(http().post(`/api/month-close/${year()}/${month()}/reopen`))
        .send({ pin: STAFF_PIN, reason: 'Кайра ачуу керек болду' })
        .expect(403);

      await asOwner(http().post(`/api/month-close/${year()}/${month()}/reopen`))
        .send({ pin: OWNER_PIN, reason: 'кыска' })
        .expect(400);

      const { body } = await asOwner(
        http().post(`/api/month-close/${year()}/${month()}/reopen`),
      )
        .send({
          pin: OWNER_PIN,
          reason: 'Аудитор августтун отчетун кайра карап чыгууну сурады',
        })
        .expect(201);
      expect(body.status).toBe('OPEN');
      expect(body.reopen_reason).toMatch(/Аудитор/);

      const entry = await prisma.audit_log.findFirst({
        where: { action: 'MONTH_REOPENED' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.reason).toMatch(/Аудитор/);

      // A month that is open again takes documents again — on its open days.
      const { body: category } = await asOwner(
        http().post('/api/expense-categories'),
      )
        .send({ name: 'Салык' })
        .expect(201);
      await asOwner(http().post('/api/expenses'))
        .send({
          category_id: category.id,
          account_id: ctx.kgsAccount,
          amount: '100.00',
          comment: 'Салык',
          business_date: otherDay(),
        })
        .expect(201);
    });

    it('refuses to reopen a month that was never closed', async () => {
      await asOwner(http().post(`/api/month-close/${year()}/${month()}/reopen`))
        .send({ pin: OWNER_PIN, reason: 'Жабылган эмес айды ачып көрөлү' })
        .expect(409);
    });
  });
});
