import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { confirmedPurchase } from './module3-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import { balanceTotals, profitAndLoss } from '../src/reports/report-math';

const decimal = (value: string) => new Prisma.Decimal(value);

describe('Financial statements (Module 15, §28)', () => {
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
    today = new Date().toISOString().slice(0, 10);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);
  const flow = () => documentFlow(app, ctx.ownerToken);

  const cashFlow = () =>
    asOwner(http().get('/api/reports/cash-flow')).query({ from: today, to: today });
  const profitLoss = () =>
    asOwner(http().get('/api/reports/profit-loss')).query({ from: today, to: today });
  const balance = () => asOwner(http().get('/api/reports/balance'));

  async function fund(amount: string, account = ctx.ownerCash) {
    return flow().createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: account,
      amount,
      comment: 'Тест: капитал',
    });
  }

  /** One cash sale: 1 unit costing `cost`, sold for `price`. */
  async function sell(price: string, cost = '4000.0000'): Promise<string> {
    await stockLayer(app, prisma, ctx, { qty: '1.00', unitCost: cost });
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00', final_price: price }],
        payments: [{ account_id: ctx.sellerCash, amount: price }],
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);
    return draft.id as string;
  }

  /** 10 units at 100 CNY, received at 13.00 — stock and the debt that bought it. */
  async function receiveTenUnits(): Promise<void> {
    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      buyCny: { amount: '2000.00', rate: '13.00' },
    });
    const { body: receipt } = await asOwner(http().post('/api/receipts'))
      .send({ purchase_id: purchaseId })
      .expect(201);
    await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
      .send({ rate_cny: '13.000000' })
      .expect(201);
    await flow().confirm(receipt.id).expect(201);
  }

  /** One unit out of whatever is on the shelf. */
  async function sellOne(price: string): Promise<string> {
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00', final_price: price }],
        payments: [{ account_id: ctx.sellerCash, amount: price }],
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);
    return draft.id as string;
  }

  async function expense(amount: string, name = `Аренда ${Math.random()}`) {
    const { body: category } = await asOwner(http().post('/api/expense-categories'))
      .send({ name })
      .expect(201);
    return flow().createAndConfirm('/api/expenses', {
      category_id: category.id,
      account_id: ctx.ownerCash,
      amount,
      comment: 'Тест: чыгым',
    });
  }

  describe('The arithmetic, stated on its own', () => {
    it('is revenue less what came back, less what it cost (§13.3, §35)', () => {
      const result = profitAndLoss({
        revenue: decimal('100000.00'),
        returns: decimal('10000.00'),
        cogs: decimal('70000.00'),
        returnedCost: decimal('7000.00'),
        operatingExpenses: decimal('12000.00'),
        otherIncome: decimal('1200.00'),
        writeOffs: decimal('5800.00'),
        inventoryResult: decimal('0.00'),
        fxGainLoss: decimal('-400.00'),
      });

      expect(result.net_revenue).toBe('90000.00');
      expect(result.net_cogs).toBe('63000.00');
      expect(result.gross_margin).toBe('27000.00');
      // 27 000 − 12 000 + 1 200 − 5 800
      expect(result.operating_profit).toBe('10400.00');
      // §42.8: the exchange difference sits below the operating result.
      expect(result.net_profit).toBe('10000.00');
    });

    it('keeps customer advances out of what customers owe (§17-А.5)', () => {
      const totals = balanceTotals({
        cash: decimal('50000.00'),
        inventoryMain: decimal('30000.00'),
        inventoryDefect: decimal('0.00'),
        customerReceivables: decimal('20000.00'),
        supplierReceivables: decimal('0.00'),
        cargoReceivables: decimal('0.00'),
        openClaims: decimal('0.00'),
        supplierPayable: decimal('0.00'),
        cargoPayable: decimal('0.00'),
        customerAdvances: decimal('20000.00'),
        capitalIn: decimal('60000.00'),
        capitalOut: decimal('0.00'),
        retainedEarnings: decimal('20000.00'),
      });

      // Assets 100 000, liabilities 20 000, equity 80 000 — the advance is a
      // liability, not a reduction of the receivable.
      expect(totals.assets).toBe('100000.00');
      expect(totals.liabilities).toBe('20000.00');
      expect(totals.equity).toBe('80000.00');
      expect(totals.balanced).toBe(true);
    });

    it('reports a difference rather than absorbing it (§27, §42.3)', () => {
      const totals = balanceTotals({
        cash: decimal('50000.00'),
        inventoryMain: decimal('0.00'),
        inventoryDefect: decimal('0.00'),
        customerReceivables: decimal('0.00'),
        supplierReceivables: decimal('0.00'),
        cargoReceivables: decimal('0.00'),
        openClaims: decimal('0.00'),
        supplierPayable: decimal('0.00'),
        cargoPayable: decimal('0.00'),
        customerAdvances: decimal('0.00'),
        capitalIn: decimal('40000.00'),
        capitalOut: decimal('0.00'),
        retainedEarnings: decimal('0.00'),
      });
      expect(totals.difference).toBe('10000.00');
      expect(totals.balanced).toBe(false);
    });
  });

  describe('ОПУ — Profit and Loss (§28)', () => {
    it('shows the margin a sale earned and the expenses against it', async () => {
      await fund('100000.00');
      await sell('9000.00', '4000.0000');
      await expense('2000.00');

      const { body } = await profitLoss().expect(200);
      expect(body.revenue).toBe('9000.00');
      expect(body.cogs).toBe('4000.00');
      expect(body.gross_margin).toBe('5000.00');
      expect(body.operating_expenses).toBe('2000.00');
      expect(body.operating_profit).toBe('3000.00');
      expect(body.sales_count).toBe(1);
      expect(body.expense_lines).toEqual([
        expect.objectContaining({ amount: '2000.00' }),
      ]);
    });

    it('never counts an owner withdrawal as an expense (§3.1.1, §3.1.6)', async () => {
      await fund('100000.00');
      await sell('9000.00', '4000.0000');

      const { body: before } = await profitLoss().expect(200);
      await flow().createAndConfirm('/api/withdrawals', {
        wtype: 'OWNER_WITHDRAWAL',
        account_id: ctx.ownerCash,
        amount: '80000.00',
        purpose: 'Жеке керекке',
      });
      const { body: after } = await profitLoss().expect(200);

      // §3.1.1's own example: the profit does not move.
      expect(after.operating_profit).toBe(before.operating_profit);
      expect(after.net_profit).toBe(before.net_profit);
      expect(after.operating_expenses).toBe(before.operating_expenses);
      // Stated plainly rather than silently dropped.
      expect(after.owner_withdrawals_excluded).toBe('80000.00');
    });

    it('takes a return off both the revenue and the cost (§35, §18.0)', async () => {
      await fund('100000.00');
      const saleId = await sell('9000.00', '4000.0000');

      const { body: item } = await asStaff(
        http().get(`/api/sales/${saleId}/preview`),
      ).expect(200);
      expect(item.lines).toHaveLength(1);

      const saleItem = await prisma.sale_items.findFirstOrThrow({
        where: { sale_id: saleId },
      });
      const { body: draft } = await asOwner(http().post('/api/returns'))
        .send({
          original_sale: saleId,
          reason: 'Кардарга жарабай калды',
          items: [
            { sale_item_id: saleItem.id, qty: '1.00', condition: 'RESALABLE' },
          ],
        })
        .expect(201);
      await asOwner(http().post(`/api/returns/${draft.id}/confirm`))
        .send({
          pin: '12345678',
          refunds: [{ account_id: ctx.sellerCash, amount: '9000.00' }],
        })
        .expect(201);

      const { body } = await profitLoss().expect(200);
      expect(body.revenue).toBe('9000.00');
      expect(body.returns).toBe('9000.00');
      expect(body.net_revenue).toBe('0.00');
      expect(body.returned_cost).toBe('4000.00');
      expect(body.net_cogs).toBe('0.00');
      expect(body.gross_margin).toBe('0.00');
    });

    it('drops an expense a correction has reversed (§27.1)', async () => {
      await fund('100000.00');
      const { id: expenseId } = await expense('35000.00', 'Аренда');

      const before = await profitLoss().expect(200);
      expect(before.body.operating_expenses).toBe('35000.00');

      const { body: correction } = await asOwner(http().post('/api/corrections'))
        .send({
          original_document_id: expenseId,
          correction_type: 'REVERSAL',
          reason: 'Аренда эки жолу киргизилип кеткен',
        })
        .expect(201);
      await asOwner(http().post(`/api/corrections/${correction.id}/confirm`))
        .send({ pin: '12345678' })
        .expect(201);

      // The money came back, and so did the expense line: a reversed document
      // is no longer a cost.
      const after = await profitLoss().expect(200);
      expect(after.body.operating_expenses).toBe('0.00');
      expect(after.body.expense_lines).toEqual([]);
      expect(after.body.net_profit).toBe('0.00');

      // In the Cash Flow both movements stand and cancel each other (§42.3).
      const { body: flowBody } = await cashFlow().expect(200);
      const operating = flowBody.sections.find(
        (section: { category: string }) => section.category === 'OPERATING',
      );
      expect(operating.out_kgs).toBe('35000.00');
      expect(operating.in_kgs).toBe('35000.00');
      expect(operating.net_kgs).toBe('0.00');
    });

    it('puts a stock shortage in a line of its own (§22)', async () => {
      await fund('100000.00');
      await receiveTenUnits();

      const { body: document } = await asOwner(http().post('/api/inventories'))
        .send({ warehouse_id: ctx.mainWarehouse })
        .expect(201);
      const { body: count } = await asOwner(
        http().get(`/api/inventories/${document.id}`),
      ).expect(200);
      await asOwner(http().patch(`/api/inventories/${document.id}/count`))
        .send({ lines: [{ line_id: count.lines[0].id, actual_qty: '8.00' }] })
        .expect(200);
      await asOwner(http().post(`/api/inventories/${document.id}/confirm`))
        .send({ pin: '12345678', reason: 'Эки мотор жетишпей чыкты' })
        .expect(201);

      // Two units at 1 300 each: §22 keeps this out of the cost of goods sold
      // and out of the bonus base, in a line of its own.
      const { body } = await profitLoss().expect(200);
      expect(body.inventory_result).toBe('2600.00');
      expect(body.cogs).toBe('0.00');
      expect(body.net_profit).toBe('-2600.00');
    });

    it('counts scrap money as income and a write-off as a loss (§38)', async () => {
      const { body } = await profitLoss().expect(200);
      expect(body.other_income).toBe('0.00');
      expect(body.write_offs).toBe('0.00');
      expect(body.net_profit).toBe('0.00');
    });
  });

  describe('ДДС — Cash Flow (§28, §3.1.5)', () => {
    it('separates trading from capital, and nets out internal moves (§19)', async () => {
      await fund('100000.00');
      await sell('9000.00', '4000.0000');
      await expense('2000.00');
      await flow().createAndConfirm('/api/transfers', {
        from_account: ctx.ownerCash,
        to_account: ctx.kgsAccount,
        amount: '5000.00',
      });

      const { body } = await cashFlow().expect(200);
      const section = (name: string) =>
        body.sections.find((s: { category: string }) => s.category === name);

      expect(section('CAPITAL_FINANCING').in_kgs).toBe('100000.00');
      expect(section('OPERATING').in_kgs).toBe('9000.00');
      expect(section('OPERATING').out_kgs).toBe('2000.00');
      // Both sides of a transfer are there, and they cancel.
      expect(section('INTERNAL_TRANSFER').net_kgs).toBe('0.00');
      expect(section('INVESTING').net_kgs).toBe('0.00');

      // 100 000 + 9 000 − 2 000, with the transfer left out of the total.
      expect(body.net_change_kgs).toBe('107000.00');
      expect(body.closing_cash_kgs).toBe('107000.00');
      expect(body.unvalued).toEqual([]);
    });

    it('shows an owner withdrawal as cash out, but not as an expense (§3.1.5)', async () => {
      await fund('100000.00');
      await flow().createAndConfirm('/api/withdrawals', {
        wtype: 'OWNER_WITHDRAWAL',
        account_id: ctx.ownerCash,
        amount: '30000.00',
        purpose: 'Жеке керекке',
      });

      const { body } = await cashFlow().expect(200);
      const capital = body.sections.find(
        (s: { category: string }) => s.category === 'CAPITAL_FINANCING',
      );
      expect(capital.out_kgs).toBe('30000.00');
      expect(capital.net_kgs).toBe('70000.00');

      const operating = body.sections.find(
        (s: { category: string }) => s.category === 'OPERATING',
      );
      expect(operating.out_kgs).toBe('0.00');
    });

    it('values a foreign account at the rate that applied when it moved (§10)', async () => {
      await flow().createAndConfirm('/api/capital', {
        source: 'OWNER',
        account_id: ctx.cnyAccount,
        amount: '1000.00',
        rate: '12.50',
      });

      const { body } = await cashFlow().expect(200);
      const line = body.sections
        .flatMap((s: { lines: unknown[] }) => s.lines)
        .find((l: { currency: string }) => l.currency === 'CNY');
      expect(line.amount).toBe('1000.00');
      expect(line.kgs).toBe('12500.00');
      expect(body.unvalued).toEqual([]);
    });

    it('opens where the day before closed', async () => {
      await fund('50000.00');
      const { body } = await cashFlow().expect(200);
      expect(body.opening_cash_kgs).toBe('0.00');
      expect(body.closing_cash_kgs).toBe('50000.00');
    });
  });

  describe('Баланс (§28, §17-А.5)', () => {
    it('holds together: capital in, goods on the shelf, money in the till', async () => {
      await fund('100000.00');
      await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '4000.0000' });

      const { body } = await balance().expect(200);
      expect(body.cash_total_kgs).toBe('100000.00');
      expect(body.inventory_main).toBe('8000.00');
      expect(body.inventory_defect).toBe('0.00');
      expect(body.capital_contributed).toBe('100000.00');
    });

    it('separates the sellable shelf from the defect one (§28, §12-А)', async () => {
      await fund('100000.00');
      await stockLayer(app, prisma, ctx, {
        qty: '1.00',
        unitCost: '4000.0000',
        warehouseId: ctx.defectWarehouse,
      });
      await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '3000.0000' });

      const { body } = await balance().expect(200);
      expect(body.inventory_defect).toBe('4000.00');
      expect(body.inventory_main).toBe('6000.00');
      expect(body.inventory_total).toBe('10000.00');
    });

    it('shows what customers owe and what they have paid ahead, apart (§17-А.5)', async () => {
      await fund('100000.00');
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '50000.00' },
      });
      await stockLayer(app, prisma, ctx, { qty: '1.00', unitCost: '4000.0000' });
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', final_price: '9000.00' },
          ],
          debt_due_date: '2026-12-31',
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);

      const { body } = await balance().expect(200);
      expect(body.customer_receivables).toBe('9000.00');
      expect(body.customer_advances).toBe('0.00');
    });

    it('holds together once goods arrive the way they really do', async () => {
      // Goods bought on credit: stock appears and so does the debt that
      // brought it. 10 × 100 CNY at 13.00 = 13 000 som (§9).
      await fund('100000.00');
      await receiveTenUnits();

      const { body } = await balance().expect(200);
      // 10 × 100 CNY at 13.00, and the supplier debt that brought them.
      expect(body.inventory_main).toBe('13000.00');
      expect(body.supplier_payable_total_kgs).toBe('13000.00');
      expect(body.balanced).toBe(true);
      expect(body.difference).toBe('0.00');
      // Nothing has been sold, so the business has earned nothing yet.
      expect(body.retained_earnings).toBe('0.00');
    });

    it('carries the profit since the beginning as retained earnings', async () => {
      await fund('100000.00');
      await receiveTenUnits();
      await sellOne('9000.00');

      const { body: pl } = await profitLoss().expect(200);
      const { body } = await balance().expect(200);

      // 9 000 revenue against a 1 300 FIFO cost (§13.3).
      expect(pl.revenue).toBe('9000.00');
      expect(pl.cogs).toBe('1300.00');
      expect(pl.gross_margin).toBe('7700.00');
      expect(body.retained_earnings).toBe(pl.net_profit);
      expect(body.retained_earnings).toBe('7700.00');
      expect(body.inventory_main).toBe('11700.00');
      expect(body.balanced).toBe(true);
      expect(body.difference).toBe('0.00');
    });

    it('balances after a withdrawal too — cash down, equity down (§3.1.5)', async () => {
      await fund('100000.00');
      await receiveTenUnits();
      await sellOne('9000.00');
      await flow().createAndConfirm('/api/withdrawals', {
        wtype: 'OWNER_WITHDRAWAL',
        account_id: ctx.ownerCash,
        amount: '20000.00',
        purpose: 'Жеке керекке',
      });

      const { body } = await balance().expect(200);
      expect(body.capital_withdrawn).toBe('20000.00');
      // The 20 000 came off the cash and off the equity, not off the profit.
      expect(body.retained_earnings).toBe('7700.00');
      expect(body.balanced).toBe(true);
      expect(body.difference).toBe('0.00');
    });
  });

  describe('Who may read them (§2)', () => {
    it('is the OWNER’s picture of the business', async () => {
      await asStaff(http().get('/api/reports/cash-flow')).expect(403);
      await asStaff(http().get('/api/reports/profit-loss')).expect(403);
      await asStaff(http().get('/api/reports/balance')).expect(403);
      await asOwner(http().get('/api/reports/balance')).expect(200);
    });
  });
});
