import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { confirmedPurchase } from './module3-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';

describe('CEO dashboard (Module 18, §32)', () => {
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

  const dashboard = () => asOwner(http().get('/api/reports/dashboard'));

  async function fund(amount: string, account = ctx.ownerCash) {
    return flow().createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: account,
      amount,
      comment: 'Тест: капитал',
    });
  }

  async function sell(params: {
    customerId?: string;
    price: string;
    cost?: string;
    onCredit?: boolean;
    dueDate?: string;
  }): Promise<string> {
    await stockLayer(app, prisma, ctx, {
      qty: '1.00',
      unitCost: params.cost ?? '4000.0000',
    });
    const { body: draft } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: params.customerId ?? ctx.walkInId,
        items: [
          { product_id: ctx.productIds[0], qty: '1.00', final_price: params.price },
        ],
        ...(params.onCredit
          ? { debt_due_date: params.dueDate ?? '2026-12-31' }
          : { payments: [{ account_id: ctx.sellerCash, amount: params.price }] }),
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);
    return draft.id as string;
  }

  it('opens on an empty business without inventing anything', async () => {
    const { body } = await dashboard().expect(200);

    expect(body.as_of).toBe(today);
    expect(body.today).toEqual({ sales: 0, revenue: '0.00', profit: '0.00' });
    expect(body.month.sales).toBe(0);
    expect(body.cash.total_kgs).toBe('0.00');
    expect(body.customers).toEqual({
      receivables: '0.00',
      overdue: '0.00',
      overdue_count: 0,
      advances: '0.00',
    });
    expect(body.stock.value_kgs).toBe('0.00');
    expect(body.top_selling).toEqual([]);
    expect(body.sellers).toEqual([]);
    // No plan is set, so there is no percentage — not 0% (§24).
    expect(body.business_plan_pct).toBeNull();
  });

  it('shows today’s and this month’s trading (§32)', async () => {
    await fund('100000.00');
    await sell({ price: '9000.00', cost: '4000.0000' });
    await sell({ price: '6000.00', cost: '4000.0000' });

    const { body } = await dashboard().expect(200);
    expect(body.today.sales).toBe(2);
    expect(body.today.revenue).toBe('15000.00');
    // 15 000 revenue against 8 000 of FIFO cost.
    expect(body.today.profit).toBe('7000.00');
    // Everything happened today, so the month reads the same.
    expect(body.month).toEqual(body.today);
  });

  it('agrees with the statement it summarises (§28)', async () => {
    await fund('100000.00');
    await sell({ price: '9000.00', cost: '4000.0000' });

    const [{ body: view }, { body: profitLoss }] = await Promise.all([
      dashboard().expect(200),
      asOwner(http().get('/api/reports/profit-loss'))
        .query({ from: today, to: today })
        .expect(200),
    ]);

    expect(view.today.revenue).toBe(profitLoss.net_revenue);
    expect(view.today.profit).toBe(profitLoss.net_profit);
  });

  it('separates the money by currency, and says what sellers still hold (§19)', async () => {
    await fund('100000.00');
    await flow().createAndConfirm('/api/capital', {
      source: 'OWNER',
      account_id: ctx.cnyAccount,
      amount: '1000.00',
      rate: '13.00',
    });
    await sell({ price: '9000.00', cost: '4000.0000' });

    const { body } = await dashboard().expect(200);
    expect(body.cash.by_currency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'KGS', kgs: '109000.00' }),
        expect.objectContaining({ currency: 'CNY', amount: '1000.00', kgs: '13000.00' }),
      ]),
    );
    expect(body.cash.total_kgs).toBe('122000.00');
    // The sale was paid into the salesperson's own till (§19).
    expect(body.cash.with_sellers_kgs).toBe('9000.00');
  });

  it('counts what customers owe, and what is already late (§16.4)', async () => {
    await prisma.customers.update({
      where: { id: ctx.customerId },
      data: { individual_credit_limit: '100000.00' },
    });
    await sell({
      customerId: ctx.customerId,
      price: '9000.00',
      onCredit: true,
      dueDate: '2026-12-31',
    });
    const lateId = await sell({
      customerId: ctx.customerId,
      price: '5000.00',
      onCredit: true,
      dueDate: '2026-12-31',
    });
    // That second debt was due long ago.
    await prisma.sales.update({
      where: { document_id: lateId },
      data: { debt_due_date: new Date('2026-01-01T00:00:00.000Z') },
    });

    const { body } = await dashboard().expect(200);
    expect(body.customers.receivables).toBe('14000.00');
    expect(body.customers.overdue).toBe('5000.00');
    expect(body.customers.overdue_count).toBe(1);
  });

  it('holds a customer advance apart from what they owe (§17-А.5)', async () => {
    await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '4000.0000' });
    const { body: reservation } = await asStaff(http().post('/api/reservations'))
      .send({
        customer_id: ctx.customerId,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
      })
      .expect(201);
    await asStaff(http().post(`/api/documents/${reservation.id}/confirm`)).expect(
      201,
    );
    await flow().createAndConfirm('/api/advances', {
      customer_id: ctx.customerId,
      reservation_id: reservation.id,
      account_id: ctx.sellerCash,
      amount: '5000.00',
    });

    const { body } = await dashboard().expect(200);
    expect(body.customers.advances).toBe('5000.00');
    expect(body.customers.receivables).toBe('0.00');
  });

  it('shows the China debt in yuan and in som (§4, §5.2)', async () => {
    await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      buyCny: { amount: '2000.00', rate: '13.00' },
    });
    const { body: receipt } = await asOwner(http().post('/api/receipts'))
      .send({ purchase_id: (await prisma.purchases.findFirstOrThrow()).document_id })
      .expect(201);
    await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
      .send({ rate_cny: '13.000000' })
      .expect(201);
    await flow().confirm(receipt.id).expect(201);

    const { body } = await dashboard().expect(200);
    expect(body.suppliers.payable_cny).toBe('1000.00');
    expect(body.suppliers.payable_kgs).toBe('13000.00');
    expect(body.stock.value_kgs).toBe('13000.00');
    expect(body.stock.qty).toBe('10.00');
  });

  it('keeps the sellable shelf apart from the defect one (§12-А)', async () => {
    await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '3000.0000' });
    await stockLayer(app, prisma, ctx, {
      qty: '1.00',
      unitCost: '4000.0000',
      warehouseId: ctx.defectWarehouse,
    });

    const { body } = await dashboard().expect(200);
    expect(body.stock.main_value_kgs).toBe('6000.00');
    expect(body.stock.defect_value_kgs).toBe('4000.00');
    expect(body.stock.value_kgs).toBe('10000.00');
  });

  it('names what has run low, and what is already on its way (§29)', async () => {
    await prisma.products.update({
      where: { id: ctx.productIds[0] },
      data: { min_stock: '5.00', reorder_point: '8.00' },
    });
    await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost: '1000.0000' });

    const { body } = await dashboard().expect(200);
    expect(body.stock.low_count).toBe(1);
    expect(body.stock.low[0]).toMatchObject({
      product_id: ctx.productIds[0],
      available: '2.00',
    });
  });

  it('ranks what sold most and what earned most — rarely the same thing', async () => {
    // Cheap and plentiful against dear and few.
    await stockLayer(app, prisma, ctx, {
      productIndex: 0,
      qty: '10.00',
      unitCost: '100.0000',
    });
    await stockLayer(app, prisma, ctx, {
      productIndex: 1,
      qty: '1.00',
      unitCost: '1000.0000',
    });
    const line = async (index: number, qty: string, price: string) => {
      const { body: draft } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.walkInId,
          items: [
            { product_id: ctx.productIds[index], qty, final_price: price },
          ],
          payments: [
            {
              account_id: ctx.sellerCash,
              amount: new Prisma.Decimal(qty).times(price).toFixed(2),
            },
          ],
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${draft.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);
    };
    await line(0, '10.00', '200.00');
    await line(1, '1.00', '9000.00');

    const { body } = await dashboard().expect(200);
    expect(body.top_selling[0].product_id).toBe(ctx.productIds[0]);
    expect(body.most_profitable[0].product_id).toBe(ctx.productIds[1]);
  });

  it('ranks the salespeople against their plan (§24, §31)', async () => {
    await sell({ price: '9000.00', cost: '4000.0000' });
    await asOwner(http().put('/api/plans'))
      .send({
        period_year: Number(today.slice(0, 4)),
        period_month: Number(today.slice(5, 7)),
        user_id: ctx.staffId,
        revenue_target: '18000.00',
      })
      .expect(200);
    await asOwner(http().put('/api/plans'))
      .send({
        period_year: Number(today.slice(0, 4)),
        period_month: Number(today.slice(5, 7)),
        revenue_target: '36000.00',
      })
      .expect(200);

    const { body } = await dashboard().expect(200);
    const seller = body.sellers.find(
      (row: { user_id: string }) => row.user_id === ctx.staffId,
    );
    expect(seller).toMatchObject({ revenue: '9000.00', sales: 1, plan_pct: '50.00' });
    expect(body.business_plan_pct).toBe('25.00');
  });

  it('is the OWNER’s screen (§2, §32)', async () => {
    await asStaff(http().get('/api/reports/dashboard')).expect(403);
    await asOwner(http().get('/api/reports/dashboard')).expect(200);
  });
});
