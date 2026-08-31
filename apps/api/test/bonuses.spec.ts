import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import { bonusBase, calculatedBonus } from '../src/bonuses/bonus-rules';
import { cashFlowCategory } from '../src/reports/cash-flow-category';

const D = (v: string) => new Prisma.Decimal(v);

describe('Seller bonus (Module 12, §23)', () => {
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
      data: { bonus_rate_pct: '10.00' },
    });
    await prisma.products.update({
      where: { id: ctx.productIds[0] },
      data: { base_markup_pct: '0.00' },
    });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  /**
   * A sale of `qty` at `price` from stock costing `unitCost`.
   *
   * The price is set per line, so the margin — and therefore the bonus — is
   * exactly what the test says it is.
   */
  async function sell(params: {
    qty: string;
    unitCost: string;
    price: string;
    paid?: string;
    dueDate?: string;
  }): Promise<{ saleId: string; itemId: string }> {
    await stockLayer(app, prisma, ctx, {
      qty: params.qty,
      unitCost: params.unitCost,
    });

    const { body: sale } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.customerId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: params.qty,
            final_price: params.price,
            discount_reason: 'Тест: баа так коюлду',
          },
        ],
        ...(params.paid && params.paid !== '0'
          ? { payments: [{ account_id: ctx.sellerCash, amount: params.paid }] }
          : {}),
        ...(params.dueDate ? { debt_due_date: params.dueDate } : {}),
      })
      .expect(201);

    await asStaff(http().post(`/api/sales/${sale.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);

    const item = await prisma.sale_items.findFirstOrThrow({
      where: { sale_id: sale.id },
    });
    return { saleId: sale.id, itemId: item.id };
  }

  describe('§23.1 — calculated on margin, not turnover', () => {
    it('follows §23’s own example: 100 000 − 70 000 at 10% → 3 000', () => {
      const base = bonusBase({ revenue: D('100000.00'), fifoCogs: D('70000.00') });
      expect(base.toFixed(2)).toBe('30000.00');
      expect(calculatedBonus(base, D('10.00')).toFixed(2)).toBe('3000.00');
    });

    it('records the sale’s own figures at confirmation', async () => {
      await sell({ qty: '10.00', unitCost: '7000.0000', price: '10000.00', paid: '100000.00' });

      const bonus = await prisma.bonuses.findFirstOrThrow();
      expect({
        revenue: bonus.revenue.toFixed(2),
        cogs: bonus.fifo_cogs.toFixed(2),
        base: bonus.bonus_base.toFixed(2),
        rate: bonus.bonus_rate.toFixed(2),
        calculated: bonus.calculated_amount.toFixed(2),
      }).toEqual({
        revenue: '100000.00',
        cogs: '70000.00',
        base: '30000.00',
        rate: '10.00',
        calculated: '3000.00',
      });
    });

    it('gives a loss sale no bonus base at all (§13.6)', () => {
      expect(
        bonusBase({
          revenue: D('5000.00'),
          fifoCogs: D('7000.00'),
          isLossSale: true,
        }).toFixed(2),
      ).toBe('0.00');
      // And an ordinary sale never has a negative base either.
      expect(
        bonusBase({ revenue: D('5000.00'), fifoCogs: D('7000.00') }).toFixed(2),
      ).toBe('0.00');
    });
  });

  describe('§23.2 — payable only when that sale is settled', () => {
    it('is CALCULATED while the sale is owed, PAYABLE once it is paid', async () => {
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '200000.00' },
      });

      const { saleId } = await sell({
        qty: '10.00',
        unitCost: '7000.0000',
        price: '10000.00',
        paid: '40000.00',
        dueDate: '2026-12-31',
      });

      const owed = await prisma.bonuses.findFirstOrThrow();
      expect(owed.bstatus).toBe('CALCULATED');
      expect(owed.payable_at).toBeNull();

      // The customer settles the rest.
      const { id } = await documentFlow(app, ctx.staffToken).createAndConfirm(
        '/api/customer-payments',
        {
          customer_id: ctx.customerId,
          lines: [{ account_id: ctx.sellerCash, amount: '60000.00' }],
        },
      );
      expect(id).toBeTruthy();

      const settled = await prisma.bonuses.findFirstOrThrow();
      expect(settled.bstatus).toBe('PAYABLE');
      expect(settled.payable_at).not.toBeNull();

      const sale = await prisma.sales.findUniqueOrThrow({
        where: { document_id: saleId },
      });
      expect(sale.outstanding_amount.toFixed(2)).toBe('0.00');
    });

    it('is payable straight away when the sale is paid at the counter', async () => {
      await sell({ qty: '1.00', unitCost: '1000.0000', price: '1500.00', paid: '1500.00' });
      const bonus = await prisma.bonuses.findFirstOrThrow();
      expect(bonus.bstatus).toBe('PAYABLE');
      expect(bonus.calculated_amount.toFixed(2)).toBe('50.00');
    });
  });

  describe('§23.4 — a return takes the bonus back with the goods', () => {
    it('reduces an unpaid bonus, and reverses it when everything comes back', async () => {
      const { saleId, itemId } = await sell({
        qty: '4.00',
        unitCost: '1000.0000',
        price: '2000.00',
        paid: '8000.00',
      });

      const before = await prisma.bonuses.findFirstOrThrow();
      // (2 000 − 1 000) × 4 = 4 000 margin, at 10% → 400.
      expect(before.calculated_amount.toFixed(2)).toBe('400.00');
      expect(before.bstatus).toBe('PAYABLE');

      const { body: half } = await asStaff(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Экөө кайтарылды',
          items: [{ sale_item_id: itemId, qty: '2.00', condition: 'RESALABLE' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/returns/${half.id}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '4000.00' }],
        })
        .expect(201);

      const reduced = await prisma.bonuses.findFirstOrThrow();
      expect(reduced.adjustment_amount.toFixed(2)).toBe('200.00');
      expect(reduced.payable_amount.toFixed(2)).toBe('200.00');
      expect(reduced.bstatus).toBe('PAYABLE');

      // The other two come back as well.
      const { body: rest } = await asStaff(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Калганы да кайтарылды',
          items: [{ sale_item_id: itemId, qty: '2.00', condition: 'RESALABLE' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/returns/${rest.id}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '4000.00' }],
        })
        .expect(201);

      const reversed = await prisma.bonuses.findFirstOrThrow();
      expect(reversed.payable_amount.toFixed(2)).toBe('0.00');
      expect(reversed.bstatus).toBe('REVERSED');
    });

    it('keeps a paid bonus and carries the difference as an adjustment', async () => {
      const { saleId, itemId } = await sell({
        qty: '4.00',
        unitCost: '1000.0000',
        price: '2000.00',
        paid: '8000.00',
      });

      await documentFlow(app, ctx.ownerToken).createAndConfirm(
        '/api/capital',
        {
          source: 'OWNER',
          account_id: ctx.ownerCash,
          amount: '10000.00',
          comment: 'Бонуска акча',
        },
      );
      await documentFlow(app, ctx.ownerToken).createAndConfirm(
        '/api/bonuses/payments',
        { employee_id: ctx.staffId, account_id: ctx.ownerCash },
      );

      const paid = await prisma.bonuses.findFirstOrThrow();
      expect(paid.bstatus).toBe('PAID');
      expect(paid.payable_amount.toFixed(2)).toBe('0.00');

      const { body: back } = await asStaff(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Экөө кайтарылды',
          items: [{ sale_item_id: itemId, qty: '2.00', condition: 'RESALABLE' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/returns/${back.id}/confirm`))
        .send({
          pin: '87654321',
          refunds: [{ account_id: ctx.sellerCash, amount: '4000.00' }],
        })
        .expect(201);

      const adjusted = await prisma.bonuses.findFirstOrThrow();
      expect(adjusted.bstatus).toBe('ADJUSTED');
      expect(adjusted.adjustment_amount.toFixed(2)).toBe('200.00');

      // The payment itself stands (§23.4).
      const payment = await prisma.bonus_payments.findFirstOrThrow();
      expect(payment.amount.toFixed(2)).toBe('400.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'BONUS_ADJUSTED_AFTER_RETURN' },
      });
      expect(entry.new_value).toMatchObject({ payment_kept: true });
    });
  });

  describe('The payment (BON)', () => {
    it('pays what is payable, out of the account it names', async () => {
      await sell({ qty: '2.00', unitCost: '1000.0000', price: '2000.00', paid: '4000.00' });
      await documentFlow(app, ctx.ownerToken).createAndConfirm('/api/capital', {
        source: 'OWNER',
        account_id: ctx.ownerCash,
        amount: '10000.00',
        comment: 'Бонуска акча',
      });

      const standing = await asOwner(http().get('/api/bonuses/standing')).expect(200);
      expect(
        standing.body.find(
          (row: { employee_id: string }) => row.employee_id === ctx.staffId,
        ),
      ).toMatchObject({ payable: '200.00', bonus_rate_pct: '10.00' });

      const { id } = await documentFlow(app, ctx.ownerToken).createAndConfirm(
        '/api/bonuses/payments',
        { employee_id: ctx.staffId, account_id: ctx.ownerCash },
      );

      const movement = await prisma.account_movements.findFirstOrThrow({
        where: { document_id: id },
      });
      expect(movement.amount.toFixed(2)).toBe('-200.00');

      const bonus = await prisma.bonuses.findFirstOrThrow();
      expect(bonus.bstatus).toBe('PAID');
      expect(bonus.payment_doc).toBe(id);
      expect(bonus.paid_at).not.toBeNull();
    });

    it('refuses more than is payable, and refuses when nothing is', async () => {
      const { body } = await asOwner(http().post('/api/bonuses/payments'))
        .send({ employee_id: ctx.staffId, account_id: ctx.ownerCash })
        .expect(422);
      expect(body.code).toBe('NOTHING_PAYABLE');

      await sell({ qty: '1.00', unitCost: '1000.0000', price: '2000.00', paid: '2000.00' });

      const over = await asOwner(http().post('/api/bonuses/payments'))
        .send({
          employee_id: ctx.staffId,
          account_id: ctx.ownerCash,
          amount: '1000.00',
        })
        .expect(422);
      expect(over.body.code).toBe('AMOUNT_OVER_PAYABLE');
      expect(over.body.payable).toBe('100.00');
    });

    it('is the OWNER’s to see and to make (§2)', async () => {
      await asStaff(http().get('/api/bonuses')).expect(403);
      await asStaff(http().post('/api/bonuses/payments'))
        .send({ employee_id: ctx.staffId, account_id: ctx.ownerCash })
        .expect(403);
    });

    it('is an operating flow, like the salary it accompanies', () => {
      expect(cashFlowCategory('BON')).toBe('OPERATING');
    });
  });

  describe('§23.5 — what never touches the base', () => {
    it('leaves the bonus alone when a later payment moves the exchange rate', async () => {
      await sell({ qty: '1.00', unitCost: '1000.0000', price: '2000.00', paid: '2000.00' });
      const before = await prisma.bonuses.findFirstOrThrow();

      // A supplier paid later at another rate books an FX result of its own;
      // §23.5 keeps it out of a sale that is already closed.
      await prisma.supplier_payments.updateMany({
        data: { fx_gain_loss_kgs: '-5000.00' },
      });

      const after = await prisma.bonuses.findFirstOrThrow();
      expect(after.bonus_base.toFixed(2)).toBe(before.bonus_base.toFixed(2));
      expect(after.calculated_amount.toFixed(2)).toBe(
        before.calculated_amount.toFixed(2),
      );
    });
  });
});
