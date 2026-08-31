import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { StockService } from '../src/stock/stock.service';
import { createTestApp } from './app-harness';
import {
  Module4Context,
  priceProduct,
  resetModule4,
  stockLayer,
} from './module4-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Sales (Module 4.4–4.8, §13, §14, §15)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stock: StockService;
  let ctx: Module4Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    stock = app.get(StockService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule4(app, prisma);
    // A predictable price: cost + 20%, no extra markup configured.
    await priceProduct(prisma, ctx.productIds[0], { baseMarkupPct: '20.00' });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const layer = (qty: string, unitCost: string, date?: string) =>
    stockLayer(app, prisma, ctx, { qty, unitCost, date });

  async function draftSale(
    body: Record<string, unknown>,
    as: 'owner' | 'staff' = 'staff',
  ): Promise<string> {
    const req = (as === 'owner' ? asOwner : asStaff)(http().post('/api/sales'));
    const { body: document } = await req.send(body).expect(201);
    return document.id as string;
  }

  const preview = (saleId: string, as: 'owner' | 'staff' = 'staff') =>
    (as === 'owner' ? asOwner : asStaff)(
      http().get(`/api/sales/${saleId}/preview`),
    );

  const confirm = (
    saleId: string,
    body: Record<string, unknown> = {},
    as: 'owner' | 'staff' = 'staff',
  ) =>
    (as === 'owner' ? asOwner : asStaff)(
      http().post(`/api/sales/${saleId}/confirm`),
    ).send(body);

  describe('§13.3 and §18.1.4 — FIFO cost and where it came from', () => {
    it('5 × 7 000 then 5 × 7 500, sell 10 → COGS 72 500 and two allocation rows', async () => {
      const first = await layer('5.00', '7000.0000', '2026-08-01');
      const second = await layer('5.00', '7500.0000', '2026-08-10');

      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '10.00', final_price: '9000.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '90000.00' }],
      });

      // 90 000 is over the PIN threshold, so the sale carries one.
      await confirm(saleId, { pin: '87654321' }).expect(201);

      const sale = await prisma.sales.findUnique({
        where: { document_id: saleId },
        include: { sale_items: { include: { sale_layer_allocations: true } } },
      });
      expect(sale!.total_cogs.toFixed(2)).toBe('72500.00');
      expect(sale!.sale_items[0].fifo_cogs.toFixed(2)).toBe('72500.00');

      const allocations = sale!.sale_items[0].sale_layer_allocations;
      expect(allocations).toHaveLength(2);
      const byLayer = new Map(allocations.map((a) => [a.layer_id, a]));
      expect(byLayer.get(first)!.qty.toFixed(2)).toBe('5.00');
      expect(byLayer.get(first)!.unit_cost.toFixed(4)).toBe('7000.0000');
      expect(byLayer.get(second)!.unit_cost.toFixed(4)).toBe('7500.0000');

      // Both layers are emptied.
      expect((await stock.onHand(prisma, first, ctx.mainWarehouse)).toFixed(2)).toBe('0.00');
      expect((await stock.onHand(prisma, second, ctx.mainWarehouse)).toFixed(2)).toBe('0.00');
    });

    it('leaves the right remainder on a partly consumed layer', async () => {
      const first = await layer('5.00', '7000.0000', '2026-08-01');
      const second = await layer('5.00', '7500.0000', '2026-08-10');

      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '7.00', final_price: '9000.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '63000.00' }],
      });
      await confirm(saleId, { pin: '87654321' }).expect(201);

      expect((await stock.onHand(prisma, first, ctx.mainWarehouse)).toFixed(2)).toBe('0.00');
      expect((await stock.onHand(prisma, second, ctx.mainWarehouse)).toFixed(2)).toBe('3.00');

      const sale = await prisma.sales.findUnique({ where: { document_id: saleId } });
      // 5 × 7 000 + 2 × 7 500 = 50 000.
      expect(sale!.total_cogs.toFixed(2)).toBe('50000.00');
    });

    it('refuses a sale of more than is in stock', async () => {
      await layer('3.00', '7000.0000');
      await expect(
        draftSale({
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '5.00', final_price: '9000.00' }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('§13.4 — below cost is refused outright', () => {
    it('refuses a salesperson', async () => {
      await layer('10.00', '7000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '6000.00',
            discount_reason: 'кардар суранды',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '6000.00' }],
      });

      const { body } = await confirm(saleId, { pin: '87654321' }).expect(422);
      expect(body.blocks.map((b: { code: string }) => b.code)).toContain('BELOW_COGS');
      expect(
        body.blocks.find((b: { code: string }) => b.code === 'BELOW_COGS').message,
      ).toMatch(/LSS/);
    });

    it('refuses the OWNER too — nobody overrides it', async () => {
      await layer('10.00', '7000.0000');
      const saleId = await draftSale(
        {
          customer_id: ctx.walkInId,
          items: [
            {
              product_id: ctx.productIds[0],
              qty: '1.00',
              final_price: '6000.00',
              discount_reason: 'OWNER чечими',
            },
          ],
          payments: [{ account_id: ctx.ownerCash, amount: '6000.00' }],
        },
        'owner',
      );

      const { body } = await confirm(saleId, { pin: '12345678' }, 'owner').expect(422);
      expect(body.blocks.map((b: { code: string }) => b.code)).toContain('BELOW_COGS');
      expect(
        body.blocks.find((b: { code: string }) => b.code === 'BELOW_COGS')
          .needs_owner_approval,
      ).toBe(false);
    });

    it('never moves the stock when it refuses', async () => {
      const layerId = await layer('10.00', '7000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '6000.00',
            discount_reason: 'себеп',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '6000.00' }],
      });
      await confirm(saleId, { pin: '87654321' }).expect(422);

      expect(
        (await stock.onHand(prisma, layerId, ctx.mainWarehouse)).toFixed(2),
      ).toBe('10.00');
      expect(
        await prisma.sale_layer_allocations.count(),
      ).toBe(0);
    });

    it('allows exactly cost — the block is "below", not "at"', async () => {
      await layer('1.00', '7000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '7000.00',
            discount_reason: 'нөлдүк маржа',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '7000.00' }],
      });
      await confirm(saleId, { pin: '87654321' }).expect(201);
    });
  });

  describe('§13.6 — the loss sale is the only way through', () => {
    it('is the OWNER\'s document alone', async () => {
      await layer('1.00', '7000.0000');
      await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.walkInId,
          is_loss_sale: true,
          loss_reason: 'эскирген товар',
          items: [{ product_id: ctx.productIds[0], qty: '1.00', final_price: '6000.00' }],
        })
        .expect(403);
    });

    it('needs a stated reason', async () => {
      await layer('1.00', '7000.0000');
      await asOwner(http().post('/api/sales'))
        .send({
          customer_id: ctx.walkInId,
          is_loss_sale: true,
          items: [{ product_id: ctx.productIds[0], qty: '1.00', final_price: '6000.00' }],
        })
        .expect(400);
    });

    it('goes through below cost, records the loss and zeroes the bonus base', async () => {
      await layer('1.00', '7000.0000');
      const saleId = await draftSale(
        {
          customer_id: ctx.walkInId,
          is_loss_sale: true,
          loss_reason: 'Кампада 2 жыл турду, ликвидация',
          items: [
            {
              product_id: ctx.productIds[0],
              qty: '1.00',
              final_price: '6000.00',
              discount_reason: 'ликвидация',
            },
          ],
          payments: [{ account_id: ctx.ownerCash, amount: '6000.00' }],
        },
        'owner',
      );

      await confirm(saleId, { pin: '12345678' }, 'owner').expect(201);

      const document = await prisma.documents.findUnique({
        where: { id: saleId },
      });
      expect(document!.doc_number).toMatch(/^LSS-/);

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'LOSS_SALE_CONFIRMED', document_id: saleId },
      });
      // Loss = 7 000 − 6 000.
      expect(audit!.new_value).toMatchObject({
        loss_amount: '1000.00',
        bonus_base: '0.00',
      });
    });
  });

  describe('§13.2 and §13.5 — the floor and the approval', () => {
    it('refuses a price under the product minimum', async () => {
      await layer('5.00', '1000.0000');
      await priceProduct(prisma, ctx.productIds[0], {
        baseMarkupPct: '20.00',
        minSellingPrice: '1500.00',
      });

      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '1400.00',
            discount_reason: 'кардар',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '1400.00' }],
      });

      const { body } = await confirm(saleId, { pin: '87654321' }).expect(422);
      expect(body.blocks.map((b: { code: string }) => b.code)).toContain('BELOW_MIN_PRICE');
    });

    it('refuses a discount past the salesperson limit until the OWNER approves', async () => {
      await layer('10.00', '1000.0000');
      await prisma.users.update({
        where: { id: ctx.staffId },
        data: { max_discount_pct: '5.00' },
      });

      // Auto price is 1 200; charging 1 000 is a 16.67% discount.
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '1000.00',
            discount_reason: 'туруктуу кардар',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '1000.00' }],
      });

      const refused = await confirm(saleId, { pin: '87654321' }).expect(422);
      const block = refused.body.blocks.find(
        (b: { code: string }) => b.code === 'DISCOUNT_OVER_LIMIT',
      );
      expect(block.needs_owner_approval).toBe(true);
      expect(block.message).toMatch(/16\.67%/);

      await asStaff(http().post(`/api/sales/${saleId}/approval-request`)).expect(201);
      await asOwner(http().post(`/api/sales/${saleId}/approval`))
        .send({ approved: true, reason: 'Туруктуу кардар, көлөм чоң' })
        .expect(201);

      await confirm(saleId, { pin: '87654321' }).expect(201);
    });

    it('records the figures the OWNER decided on (§13.8)', async () => {
      await layer('10.00', '1000.0000');
      await prisma.users.update({
        where: { id: ctx.staffId },
        data: { max_discount_pct: '5.00' },
      });
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '1000.00',
            discount_reason: 'туруктуу кардар',
          },
        ],
      });

      await asStaff(http().post(`/api/sales/${saleId}/approval-request`)).expect(201);

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'SALE_DISCOUNT_APPROVAL_REQUESTED', document_id: saleId },
      });
      expect(audit!.new_value).toMatchObject({
        auto_total: '1200.00',
        final_total: '1000.00',
        discount_amount: '200.00',
        discount_pct: '16.67',
        fifo_cogs: '1000.00',
        margin: '0.00',
      });
    });

    it('a rejected approval leaves the sale blocked', async () => {
      await layer('10.00', '1000.0000');
      await prisma.users.update({
        where: { id: ctx.staffId },
        data: { max_discount_pct: '5.00' },
      });
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '1000.00',
            discount_reason: 'себеп',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '1000.00' }],
      });

      await asStaff(http().post(`/api/sales/${saleId}/approval-request`)).expect(201);
      await asOwner(http().post(`/api/sales/${saleId}/approval`))
        .send({ approved: false, reason: 'Маржа өтө аз' })
        .expect(201);

      await confirm(saleId, { pin: '87654321' }).expect(422);
    });

    it('needs a reason for any manual discount (§13.8)', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00', final_price: '1100.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1100.00' }],
      });

      const { body } = await confirm(saleId, { pin: '87654321' }).expect(422);
      expect(body.blocks.map((b: { code: string }) => b.code)).toContain(
        'MISSING_DISCOUNT_REASON',
      );
    });
  });

  describe('§19 — the money lands in the salesperson\'s own account', () => {
    it('refuses another person\'s till', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '1000.0000' });
      // The staff member's sale cannot land in the OWNER's till.
      await expect(
        draftSale({
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          payments: [{ account_id: ctx.ownerCash, amount: '1200.00' }],
        }),
      ).rejects.toThrow();
    });

    it('refuses a company account with no owner', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '1000.0000' });
      const shared = await prisma.payment_accounts.create({
        data: { name: 'Company Cash', type: 'CASH', currency: 'KGS' },
        select: { id: true },
      });

      await expect(
        draftSale({
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          payments: [{ account_id: shared.id, amount: '1200.00' }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('§15 — mixed payment and change', () => {
    it('splits across channels and posts to each account (§19)', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '2.00' }],
        payments: [
          { account_id: ctx.sellerCash, amount: '1400.00' },
          { account_id: ctx.sellerBank, amount: '1000.00' },
        ],
      });

      await confirm(saleId).expect(201);

      const movements = await prisma.account_movements.findMany({
        where: { document_id: saleId },
      });
      expect(movements).toHaveLength(2);
      const byAccount = new Map(movements.map((m) => [m.account_id, m.amount]));
      expect(byAccount.get(ctx.sellerCash)!.toFixed(2)).toBe('1400.00');
      expect(byAccount.get(ctx.sellerBank)!.toFixed(2)).toBe('1000.00');
    });

    it('the §15.2 example: 8 000 total, 10 000 cash → 2 000 change, 8 000 in the till', async () => {
      await layer('10.00', '1000.0000');
      // 8 000 exactly: 20/3 units is not whole, so price the line directly.
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '8.00',
            final_price: '1000.00',
            discount_reason: '§15.2 мисалы',
          },
        ],
        payments: [
          { account_id: ctx.sellerCash, amount: '8000.00', cash_given: '10000.00' },
        ],
      });

      await confirm(saleId, { pin: '87654321' }).expect(201);

      const lines = await prisma.sale_payment_lines.findMany({
        where: { sale_id: saleId },
      });
      expect(lines[0].cash_given!.toFixed(2)).toBe('10000.00');
      expect(lines[0].change_given!.toFixed(2)).toBe('2000.00');
      // Net cash increase is 8 000, not 10 000 (§15.2).
      expect(lines[0].amount.toFixed(2)).toBe('8000.00');

      const movement = await prisma.account_movements.findFirst({
        where: { document_id: saleId, account_id: ctx.sellerCash },
      });
      expect(movement!.amount.toFixed(2)).toBe('8000.00');
    });

    it('refuses change from a bank account (§15.2)', async () => {
      await layer('10.00', '1000.0000');
      await expect(
        draftSale({
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          payments: [
            { account_id: ctx.sellerBank, amount: '1200.00', cash_given: '1500.00' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('refuses paying more than the sale without calling it change (§15.1)', async () => {
      await layer('10.00', '1000.0000');
      await expect(
        draftSale({
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          payments: [{ account_id: ctx.sellerCash, amount: '5000.00' }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('§11.1 — Walk-in', () => {
    it('refuses a sale that leaves anything owed', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '500.00' }],
        debt_due_date: '2026-12-31',
      });

      const { body } = await confirm(saleId, { pin: '87654321' }).expect(422);
      expect(JSON.stringify(body)).toMatch(/Walk-in/);
    });

    it('refuses a sale with no payment at all', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        debt_due_date: '2026-12-31',
      });
      await confirm(saleId, { pin: '87654321' }).expect(422);
    });

    it('goes through when Outstanding is zero (§11.1.2)', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1200.00' }],
      });
      await confirm(saleId).expect(201);

      const sale = await prisma.sales.findUnique({ where: { document_id: saleId } });
      expect(sale!.outstanding_amount.toFixed(2)).toBe('0.00');
      expect(sale!.debt_status).toBe('CLOSED');
    });

    it('is the default customer when none is given', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1200.00' }],
      });
      const { body } = await preview(saleId).expect(200);
      expect(body.customer.is_walk_in).toBe(true);
    });
  });

  describe('the PIN, only when the sale departs from the fast path', () => {
    it('asks for nothing on an ordinary paid sale', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '4.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '4800.00' }],
      });

      const { body } = await preview(saleId).expect(200);
      expect(body.pin_required).toBe(false);
      await confirm(saleId).expect(201);
    });

    it('asks when a discount was given by hand', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [
          {
            product_id: ctx.productIds[0],
            qty: '1.00',
            final_price: '1150.00',
            discount_reason: 'кардар',
          },
        ],
        payments: [{ account_id: ctx.sellerCash, amount: '1150.00' }],
      });

      const { body } = await preview(saleId).expect(200);
      expect(body.pin_required).toBe(true);
      expect(body.pin_reasons).toContain('кол менен скидка берилди');

      await confirm(saleId).expect(422);
      await confirm(saleId, { pin: '87654321' }).expect(201);
    });

    it('asks when the total reaches the threshold', async () => {
      await layer('100.00', '1000.0000');
      // 50 units × 1 200 = 60 000, over the 50 000 threshold.
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '50.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '60000.00' }],
      });

      const { body } = await preview(saleId).expect(200);
      expect(body.pin_required).toBe(true);
      await confirm(saleId).expect(422);
      await confirm(saleId, { pin: '87654321' }).expect(201);
    });

    it('refuses a wrong PIN and records the attempt in the Security Log', async () => {
      await layer('100.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '50.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '60000.00' }],
      });

      const { body } = await confirm(saleId, { pin: '00000000' }).expect(422);
      expect(body.code).toBe('PIN_INVALID');

      const failed = await prisma.security_log.findFirst({
        where: { event: 'PIN_FAIL', user_id: ctx.staffId },
      });
      expect(failed).not.toBeNull();

      await confirm(saleId, { pin: '87654321' }).expect(201);
      const ok = await prisma.security_log.findFirst({
        where: { event: 'PIN_OK', user_id: ctx.staffId },
      });
      expect(ok).not.toBeNull();
    });
  });

  describe('§27.1 — a confirmed sale does not change', () => {
    it('refuses to confirm twice', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1200.00' }],
      });
      await confirm(saleId).expect(201);
      await confirm(saleId).expect(409);
    });

    it('refuses to change the payment lines afterwards', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1200.00' }],
      });
      await confirm(saleId).expect(201);

      await asStaff(http().post(`/api/sales/${saleId}/payments`))
        .send({ payments: [{ account_id: ctx.sellerCash, amount: '1.00' }] })
        .expect(409);
    });
  });

  describe('concurrency', () => {
    it('lets only one of two sales take the last unit', async () => {
      await layer('1.00', '1000.0000');

      const first = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1200.00' }],
      });
      const second = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [{ account_id: ctx.sellerCash, amount: '1200.00' }],
      });

      const results = await Promise.all([
        confirm(first).then((r) => r.status),
        confirm(second).then((r) => r.status),
      ]);

      expect(results.filter((s) => s === 201)).toHaveLength(1);
      expect(results.filter((s) => s !== 201)).toHaveLength(1);

      // No oversell, no negative stock.
      const rows = await prisma.layer_stock.findMany();
      for (const row of rows) {
        expect(row.qty.greaterThanOrEqualTo(0)).toBe(true);
      }
      const confirmedSales = await prisma.sales.count({
        where: {
          documents_sales_document_idTodocuments: { status: 'CONFIRMED' },
        },
      });
      expect(confirmedSales).toBe(1);
    });
  });

  describe('what the salesperson sees', () => {
    it('hides the cost figure unless the setting allows it', async () => {
      await layer('10.00', '1000.0000');
      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
      });

      const staffView = await preview(saleId).expect(200);
      expect(staffView.body.totals.fifo_cogs).toBeNull();
      expect(staffView.body.lines[0].fifo_cogs).toBeNull();

      const ownerView = await preview(saleId, 'owner').expect(200);
      expect(ownerView.body.totals.fifo_cogs).toBe('1000.00');
    });

    it('shows it once the OWNER turns the setting on', async () => {
      await layer('10.00', '1000.0000');
      await asOwner(http().put('/api/settings/sale.show_cogs_to_staff'))
        .send({ value: true })
        .expect(200);

      const saleId = await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
      });
      const { body } = await preview(saleId).expect(200);
      expect(body.totals.fifo_cogs).toBe('1000.00');
    });

    it('sees only their own sales (§2)', async () => {
      await layer('10.00', '1000.0000');
      await draftSale({
        customer_id: ctx.walkInId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
      });

      const staffList = await asStaff(http().get('/api/sales')).expect(200);
      expect(staffList.body).toHaveLength(1);

      const ownerSale = await draftSale(
        {
          customer_id: ctx.walkInId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        },
        'owner',
      );
      const stillStaff = await asStaff(http().get('/api/sales')).expect(200);
      expect(
        stillStaff.body.map((s: { document_id: string }) => s.document_id),
      ).not.toContain(ownerSale);
    });
  });
});
