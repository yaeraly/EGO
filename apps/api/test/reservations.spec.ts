import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';
import { ReservationsService } from '../src/reservations/reservations.service';
import { SettingKey } from '../src/settings/setting-keys';

const HOUR = 3_600_000;

describe('Reservation and advance (Module 6, §17, §17-А)', () => {
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

  const inHours = (hours: number) =>
    new Date(Date.now() + hours * HOUR).toISOString();

  async function setting(key: string, value: unknown): Promise<void> {
    await prisma.settings.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
  }

  /** Stock the shop actually holds, priced so a sale can be made from it. */
  async function stocked(qty: string, unitCost = '100.0000'): Promise<void> {
    await stockLayer(app, prisma, ctx, { qty, unitCost });
    await prisma.products.update({
      where: { id: ctx.productIds[0] },
      data: { base_markup_pct: '50.00' },
    });
  }

  async function reserve(
    body: Record<string, unknown>,
    token = ctx.staffToken,
  ): Promise<{ id: string; doc_number: string }> {
    return documentFlow(app, token).createAndConfirm('/api/reservations', {
      customer_id: ctx.customerId,
      expires_at: inHours(24),
      ...body,
    });
  }

  describe('Holding stock (§17, §42.2)', () => {
    it('takes the reserved quantity out of what is available to sell', async () => {
      await stocked('10.00');

      const before = await asStaff(
        http().get(`/api/stock?warehouse_id=${ctx.mainWarehouse}`),
      ).expect(200);
      expect(before.body[0]).toMatchObject({
        current_qty: '10.00',
        reserved_qty: '0.00',
        available_qty: '10.00',
      });

      await reserve({ items: [{ product_id: ctx.productIds[0], qty: '4.00' }] });

      const after = await asStaff(http().get('/api/stock')).expect(200);
      expect(after.body[0]).toMatchObject({
        current_qty: '10.00',
        reserved_qty: '4.00',
        available_qty: '6.00',
      });
    });

    it('refuses to sell goods promised to someone else (§42.2)', async () => {
      await stocked('5.00');
      await reserve({ items: [{ product_id: ctx.productIds[0], qty: '4.00' }] });

      const other = await prisma.customers.create({
        data: { name: 'Башка кардар', ctype: 'RETAIL' },
        select: { id: true },
      });

      const { body: sale } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: other.id,
          items: [{ product_id: ctx.productIds[0], qty: '3.00' }],
          payments: [{ account_id: ctx.sellerCash, amount: '450.00' }],
        })
        .expect(201);

      const { body } = await asStaff(
        http().post(`/api/documents/${sale.id}/confirm`),
      ).expect(409);
      expect(body.message).toContain('брондолгон');

      // What is not reserved still sells.
      const { body: small } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: other.id,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          payments: [{ account_id: ctx.sellerCash, amount: '150.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${small.id}/confirm`)).expect(201);
    });

    it('refuses a reservation the stock cannot back', async () => {
      await stocked('3.00');
      await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '5.00' }],
        })
        .expect(201)
        .then(({ body }) =>
          asStaff(http().post(`/api/documents/${body.id}/confirm`)).expect(409),
        );
    });

    it('lets only one of two reservations take the last unit', async () => {
      await stocked('1.00');
      const flow = documentFlow(app, ctx.staffToken);

      const [first, second] = await Promise.all([
        flow
          .create('/api/reservations', {
            customer_id: ctx.customerId,
            expires_at: inHours(24),
            items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          })
          .expect(201),
        flow
          .create('/api/reservations', {
            customer_id: ctx.customerId,
            expires_at: inHours(24),
            items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          })
          .expect(201),
      ]);

      const results = await Promise.all([
        flow.confirm(first.body.id),
        flow.confirm(second.body.id),
      ]);
      const codes = results.map((result) => result.status).sort();
      expect(codes).toEqual([201, 409]);
    });
  });

  describe('Expiry (§17.3)', () => {
    it('frees the stock the moment it expires, before anything has run', async () => {
      await stocked('5.00');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '5.00' }],
      });

      const held = await asStaff(http().get('/api/stock')).expect(200);
      expect(held.body[0].available_qty).toBe('0.00');

      // The clock, not the job, is what ends a hold.
      await prisma.reservations.update({
        where: { document_id: reservation.id },
        data: { expires_at: new Date(Date.now() - HOUR) },
      });

      const freed = await asStaff(http().get('/api/stock')).expect(200);
      expect(freed.body[0]).toMatchObject({
        reserved_qty: '0.00',
        available_qty: '5.00',
      });

      // The job then records what already happened.
      const expired = await app.get(ReservationsService).expireDue();
      expect(expired).toBe(1);
      const { body } = await asStaff(
        http().get(`/api/reservations/${reservation.id}`),
      ).expect(200);
      expect(body.status).toBe('EXPIRED');
      expect(body.is_live).toBe(false);
    });

    it('will not confirm a reservation that has already run out', async () => {
      await stocked('5.00');
      const { body: document } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(1),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(201);

      await prisma.reservations.update({
        where: { document_id: document.id },
        data: { expires_at: new Date(Date.now() - HOUR) },
      });

      await asStaff(http().post(`/api/documents/${document.id}/confirm`)).expect(409);
    });

    it('needs an expiry, and says so when no default is configured', async () => {
      await stocked('5.00');
      const { body } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(400);
      expect(body.message).toContain(SettingKey.RESERVATION_DEFAULT_DURATION_HOURS);
    });

    it('caps a reservation taken with no advance (§17.3)', async () => {
      await stocked('5.00');
      await setting(SettingKey.RESERVATION_MAX_NO_ADVANCE_HOURS, 24);

      await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(48),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(422);

      await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(12),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(201);
    });
  });

  describe('Who may reserve (§17.3, §16.4)', () => {
    it('refuses the Walk-in customer', async () => {
      await stocked('5.00');
      const walkIn = await prisma.customers.findFirstOrThrow({
        where: { is_walk_in: true },
      });

      await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: walkIn.id,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(409);
    });

    it('holds the active-reservation limit, and lets the OWNER past it with a reason', async () => {
      await stocked('10.00');
      await setting(SettingKey.RESERVATION_MAX_ACTIVE_PER_CUSTOMER, 1);

      await reserve({ items: [{ product_id: ctx.productIds[0], qty: '1.00' }] });

      const { body } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        })
        .expect(422);
      expect(body.code).toBe('MAX_ACTIVE_RESERVATIONS');

      await asOwner(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
          override_reason: 'Туруктуу кардар, ээси уруксат берди',
        })
        .expect(201);

      const overrides = await prisma.audit_log.findMany({
        where: { action: 'RESERVATION_BLOCK_OVERRIDDEN' },
      });
      expect(overrides).toHaveLength(1);
      expect(overrides[0].reason).toContain('ээси уруксат берди');
    });
  });

  describe('Advance requirement (§17.3)', () => {
    it('computes §17.3’s own example: 20 000 threshold, 20%, 50 000 reserved', async () => {
      await stocked('100.00', '333.3333');
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { base_markup_pct: '0.00', min_selling_price: null },
      });
      await setting(SettingKey.RESERVATION_ADVANCE_REQUIRED_ABOVE_KGS, 20000);
      await setting(SettingKey.RESERVATION_MIN_ADVANCE_PCT, 20);

      // 100 × 500.00 = 50 000.00 reserved.
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { base_markup_pct: '50.00' },
      });

      const { body: document } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '100.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${document.id}/confirm`)).expect(201);

      const { body } = await asStaff(
        http().get(`/api/reservations/${document.id}`),
      ).expect(200);
      expect(body.total_amount).toBe('50000.00');
      expect(body.advance_required).toBe('10000.00');
      expect(body.advance_paid).toBe('0.00');
      expect(body.advance_outstanding).toBe('10000.00');
    });

    it('refuses rather than guessing when the percentage is not configured', async () => {
      await stocked('10.00');
      await setting(SettingKey.RESERVATION_ADVANCE_REQUIRED_ABOVE_KGS, 100);

      const { body } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '5.00' }],
        })
        .expect(422);
      expect(body.message).toContain(SettingKey.RESERVATION_MIN_ADVANCE_PCT);
    });

    it('honours a product that always demands an advance, whatever the total', async () => {
      await stocked('10.00');
      await setting(SettingKey.RESERVATION_MIN_ADVANCE_PCT, 10);
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { reservation_advance_required: true, reservation_min_advance_pct: '30.00' },
      });

      const { body: document } = await asStaff(http().post('/api/reservations'))
        .send({
          customer_id: ctx.customerId,
          expires_at: inHours(24),
          items: [{ product_id: ctx.productIds[0], qty: '2.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${document.id}/confirm`)).expect(201);

      // 2 × 150.00 = 300.00, and the product's own 30% beats the policy's 10%.
      const { body } = await asStaff(
        http().get(`/api/reservations/${document.id}`),
      ).expect(200);
      expect(body.total_amount).toBe('300.00');
      expect(body.advance_required).toBe('90.00');
    });
  });

  describe('Cancelling (§17.2)', () => {
    it('frees the stock and keeps the reason', async () => {
      await stocked('5.00');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '5.00' }],
      });

      const { body } = await asStaff(
        http().post(`/api/reservations/${reservation.id}/cancel`),
      )
        .send({ reason: 'Кардар баш тартты' })
        .expect(201);
      expect(body.status).toBe('CANCELLED');
      expect(body.cancel_reason).toBe('Кардар баш тартты');

      const stock = await asStaff(http().get('/api/stock')).expect(200);
      expect(stock.body[0].available_qty).toBe('5.00');

      const entries = await prisma.audit_log.findMany({
        where: { action: 'RESERVATION_CANCELLED' },
      });
      expect(entries).toHaveLength(1);
    });

    it('will not cancel one that is already cancelled', async () => {
      await stocked('5.00');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
      });
      await asStaff(http().post(`/api/reservations/${reservation.id}/cancel`))
        .send({ reason: 'Биринчи жолу' })
        .expect(201);
      await asStaff(http().post(`/api/reservations/${reservation.id}/cancel`))
        .send({ reason: 'Экинчи жолу' })
        .expect(409);
    });
  });

  describe('Fulfilling a reservation (§17.1)', () => {
    it('charges the price fixed when the reservation was made', async () => {
      await stocked('10.00', '100.0000');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '2.00' }],
      });

      // The list price moves after the reservation is taken.
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { base_markup_pct: '100.00' },
      });

      const { body: sale } = await asStaff(http().post('/api/sales'))
        .send({
          from_reservation: reservation.id,
          payments: [{ account_id: ctx.sellerCash, amount: '300.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${sale.id}/confirm`)).expect(201);

      const stored = await prisma.sales.findUniqueOrThrow({
        where: { document_id: sale.id },
      });
      // 2 × 150.00 fixed at reservation time, not 2 × 200.00.
      expect(stored.total_amount.toFixed(2)).toBe('300.00');
      expect(stored.from_reservation).toBe(reservation.id);

      const { body } = await asStaff(
        http().get(`/api/reservations/${reservation.id}`),
      ).expect(200);
      expect(body.status).toBe('FULFILLED');
      expect(body.fulfilled_sale).toBe(sale.id);
    });

    it('still refuses a fixed price that has fallen below cost (§13.4)', async () => {
      await stocked('10.00', '100.0000');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '2.00' }],
      });

      // The next units in cost more than the reservation's fixed price.
      await stockLayer(app, prisma, ctx, {
        qty: '10.00',
        unitCost: '400.0000',
        date: '2026-07-01',
      });

      const { body: sale } = await asStaff(http().post('/api/sales'))
        .send({
          from_reservation: reservation.id,
          payments: [{ account_id: ctx.sellerCash, amount: '300.00' }],
        })
        .expect(201);

      const { body } = await asStaff(
        http().post(`/api/documents/${sale.id}/confirm`),
      ).expect(422);
      expect(JSON.stringify(body.blocks)).toContain('BELOW_COGS');
    });

    it('is not blocked by its own hold', async () => {
      await stocked('2.00');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '2.00' }],
      });

      const { body: sale } = await asStaff(http().post('/api/sales'))
        .send({
          from_reservation: reservation.id,
          payments: [{ account_id: ctx.sellerCash, amount: '300.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/documents/${sale.id}/confirm`)).expect(201);
    });
  });

  describe('Advance (§17-А)', () => {
    async function takeAdvance(
      amount: string,
      reservationId?: string,
    ): Promise<string> {
      const { id } = await documentFlow(app, ctx.staffToken).createAndConfirm(
        '/api/advances',
        {
          customer_id: ctx.customerId,
          account_id: ctx.sellerCash,
          amount,
          ...(reservationId ? { reservation_id: reservationId } : {}),
        },
      );
      return id;
    }

    it('is cash in and a liability, not revenue (§17-А.1)', async () => {
      const advanceId = await takeAdvance('20000.00');

      const { body: accounts } = await asStaff(
        http().get('/api/accounts/balances'),
      ).expect(200);
      const till = accounts.find(
        (account: { account_id: string }) => account.account_id === ctx.sellerCash,
      );
      expect(till.balance).toBe('20000.00');

      const advance = await prisma.advances.findUniqueOrThrow({
        where: { document_id: advanceId },
      });
      expect(advance.amount.toFixed(2)).toBe('20000.00');
      expect(advance.applied_amount.toFixed(2)).toBe('0.00');
      expect(advance.astatus).toBe('ACTIVE');

      // Nothing was sold, so no sale exists to carry revenue.
      expect(await prisma.sales.count()).toBe(0);
    });

    it('pays for the sale it was taken for (§17-А.2)', async () => {
      await stocked('100.00', '100.0000');
      await takeAdvance('20000.00');

      // 200 × 150.00 = 30 000; 20 000 advance + 10 000 cash settles it.
      const { body: sale } = await asStaff(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [{ product_id: ctx.productIds[0], qty: '100.00' }],
          payments: [{ account_id: ctx.sellerCash, amount: '5000.00' }],
        })
        .expect(201);
      await asStaff(http().post(`/api/sales/${sale.id}/confirm`))
        .send({ pin: '87654321' })
        .expect(201);

      const stored = await prisma.sales.findUniqueOrThrow({
        where: { document_id: sale.id },
      });
      expect(stored.total_amount.toFixed(2)).toBe('15000.00');
      // 5 000 cash + 10 000 of the advance leaves nothing owed.
      expect(stored.outstanding_amount.toFixed(2)).toBe('0.00');

      const advances = await prisma.advances.findMany();
      expect(advances[0].applied_amount.toFixed(2)).toBe('10000.00');
      expect(advances[0].astatus).toBe('PARTIALLY_APPLIED');
    });

    it('settles the debt before handing any cash back (§17-А.4, §35.4)', async () => {
      await stocked('100.00', '100.0000');

      // §16.1 — a customer with no limit gets no credit at all, so the debt
      // this test needs has to be allowed first.
      await prisma.customers.update({
        where: { id: ctx.customerId },
        data: { individual_credit_limit: '20000.00' },
      });

      const { body: debtSale } = await asOwner(http().post('/api/sales'))
        .send({
          customer_id: ctx.customerId,
          items: [{ product_id: ctx.productIds[0], qty: '46.00' }],
          debt_due_date: '2026-12-31',
        })
        .expect(201);
      // A debt sale takes a PIN and, with no limit configured, the OWNER's
      // §16.5 override — both go to the sale's own confirm endpoint.
      await asOwner(http().post(`/api/sales/${debtSale.id}/confirm`))
        .send({ pin: '12345678' })
        .expect(201);

      const debt = await prisma.sales.findUniqueOrThrow({
        where: { document_id: debtSale.id },
      });
      const owed = debt.outstanding_amount;
      expect(owed.greaterThan(0)).toBe(true);

      const advanceId = await takeAdvance(owed.plus(3000).toFixed(2));

      const { body } = await asStaff(
        http().post(`/api/advances/${advanceId}/refund`),
      )
        .send({
          pin: '87654321',
          lines: [{ account_id: ctx.sellerCash, amount: '3000.00' }],
          reason: 'Бронь жокко чыгарылды',
        })
        .expect(201);

      expect(body.astatus).toBe('REFUNDED');

      const settled = await prisma.sales.findUniqueOrThrow({
        where: { document_id: debtSale.id },
      });
      expect(settled.outstanding_amount.toFixed(2)).toBe('0.00');

      const lines = await prisma.advance_refund_lines.findMany({
        where: { advance_id: advanceId },
        orderBy: { id: 'asc' },
      });
      // One offset line against the sale, one cash line out of the till.
      expect(lines.map((line) => [line.sale_id !== null, line.amount.toFixed(2)])).toEqual([
        [true, owed.toFixed(2)],
        [false, '3000.00'],
      ]);
    });

    it('refuses a refund whose cash amount does not match what is left', async () => {
      const advanceId = await takeAdvance('5000.00');
      const { body } = await asStaff(
        http().post(`/api/advances/${advanceId}/refund`),
      )
        .send({
          pin: '87654321',
          lines: [{ account_id: ctx.sellerCash, amount: '4000.00' }],
        })
        .expect(422);
      expect(body.code).toBe('REFUND_AMOUNT_MISMATCH');
      expect(body.cash_refund).toBe('5000.00');
    });

    it('needs a reason when the money leaves another account (§35.5)', async () => {
      const advanceId = await takeAdvance('1000.00');

      const { body } = await asStaff(
        http().post(`/api/advances/${advanceId}/refund`),
      )
        .send({
          pin: '87654321',
          lines: [{ account_id: ctx.ownerCash, amount: '1000.00' }],
        })
        .expect(422);
      expect(body.code).toBe('REFUND_SOURCE_OVERRIDE_REASON_REQUIRED');
    });

    it('always takes a PIN (§17-А.4)', async () => {
      const advanceId = await takeAdvance('1000.00');
      const { body } = await asStaff(
        http().post(`/api/advances/${advanceId}/refund`),
      )
        .send({
          pin: '00000000',
          lines: [{ account_id: ctx.sellerCash, amount: '1000.00' }],
        })
        .expect(422);
      expect(body.code).toBe('PIN_INVALID');

      const attempts = await prisma.security_log.findMany({
        where: { event: 'PIN_FAIL' },
      });
      expect(attempts.length).toBeGreaterThan(0);
    });

    it('is not held for the Walk-in customer (§17.3)', async () => {
      const walkIn = await prisma.customers.findFirstOrThrow({
        where: { is_walk_in: true },
      });
      await asStaff(http().post('/api/advances'))
        .send({
          customer_id: walkIn.id,
          account_id: ctx.sellerCash,
          amount: '1000.00',
        })
        .expect(409);
    });

    it('shows on the reservation what has been paid against it', async () => {
      await stocked('10.00');
      const reservation = await reserve({
        items: [{ product_id: ctx.productIds[0], qty: '2.00' }],
      });
      await takeAdvance('100.00', reservation.id);

      const { body } = await asStaff(
        http().get(`/api/reservations/${reservation.id}`),
      ).expect(200);
      expect(body.advance_paid).toBe('100.00');
    });
  });
});
