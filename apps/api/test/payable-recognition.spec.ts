import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, purchase_status } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module3Context, confirmedPurchase, resetModule3 } from './module3-harness';

/**
 * When we owe the supplier (§6.1).
 *
 * The partner gathers the parts we asked for; the money falls due when the
 * goods leave their warehouse. Until then an order is a request, not a debt —
 * and from then until the receipt the supplier owes us the shipment, which is
 * the asset that faces the debt on the Balance.
 */
describe('The supplier debt falls due at shipment (§6.1)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module3Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule3(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);

  /**
   * A confirmed order, with yuan bought first so §10.1 has a reference rate
   * to book the debt at when it falls due.
   */
  const order = (priceCny = '100.00', qty = '10.00') =>
    confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty, priceCny }],
      buyCny: { amount: '20000.00', rate: '13.00' },
    });

  const setStage = (purchaseId: string, status: purchase_status) =>
    asOwner(http().post(`/api/purchases/${purchaseId}/status`)).send({
      status,
      reason: 'test',
    });

  const payables = (purchaseId: string) =>
    prisma.supplier_ledger.findMany({
      where: { document_id: purchaseId, entry_type: 'PAYABLE' },
    });

  const ledger = async (): Promise<{ we_owe_cny: string }> => {
    const { body } = await asOwner(
      http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
    ).expect(200);
    return body;
  };

  const balance = async () => {
    const { body } = await asOwner(http().get('/api/reports/balance')).expect(200);
    return body;
  };

  it('owes nothing while the partner is still gathering the order', async () => {
    const purchaseId = await order();

    expect(await payables(purchaseId)).toEqual([]);
    expect((await ledger()).we_owe_cny).toBe('0.00');

    await setStage(purchaseId, purchase_status.SENT_TO_SUPPLIER).expect(201);
    await setStage(purchaseId, purchase_status.SUPPLIER_ACCEPTED).expect(201);
    await setStage(purchaseId, purchase_status.COLLECTING).expect(201);

    expect(await payables(purchaseId)).toEqual([]);
  });

  it('owes for the goods the moment they leave the supplier', async () => {
    const purchaseId = await order();
    await setStage(purchaseId, purchase_status.LEFT_SUPPLIER).expect(201);

    const [entry] = await payables(purchaseId);
    // 10 × 100 CNY, stored as a debt (negative, §4.2).
    expect(entry.amount_cny.toFixed(2)).toBe('-1000.00');
    expect((await ledger()).we_owe_cny).toBe('1000.00');
  });

  it('recognises it once, however many stages follow', async () => {
    const purchaseId = await order();
    await setStage(purchaseId, purchase_status.LEFT_SUPPLIER).expect(201);
    await setStage(purchaseId, purchase_status.ARRIVED_YIWU_CARGO).expect(201);
    await setStage(purchaseId, purchase_status.IN_TRANSIT).expect(201);

    expect(await payables(purchaseId)).toHaveLength(1);
    expect((await ledger()).we_owe_cny).toBe('1000.00');
  });

  it('recognises it on a jump straight past the shipping stage', async () => {
    // Word from China arrives late: an order turns out to be in transit
    // already, and the OWNER sets that stage without the ones before it.
    const purchaseId = await order();
    await setStage(purchaseId, purchase_status.IN_TRANSIT).expect(201);

    expect(await payables(purchaseId)).toHaveLength(1);
  });

  it('keeps the debt when a mistaken stage is moved back (§27.1)', async () => {
    const purchaseId = await order();
    await setStage(purchaseId, purchase_status.LEFT_SUPPLIER).expect(201);
    await setStage(purchaseId, purchase_status.COLLECTING).expect(201);

    // A debt that comes and goes with a dropdown is not a debt: undoing it is
    // what a correction is for.
    expect(await payables(purchaseId)).toHaveLength(1);
    expect((await ledger()).we_owe_cny).toBe('1000.00');
  });

  describe('On the Balance', () => {
    it('shows shipped goods as ours to receive, against the debt', async () => {
      const before = await balance();
      expect(before.goods_in_transit).toBe('0.00');

      const purchaseId = await order();
      await setStage(purchaseId, purchase_status.LEFT_SUPPLIER).expect(201);

      const after = await balance();
      // The debt and the shipment we are owed appear together and match, so
      // the books still hold (§42.3).
      expect(after.goods_in_transit).toBe(after.supplier_payable_total_kgs);
      expect(new Prisma.Decimal(after.goods_in_transit).greaterThan(0)).toBe(
        true,
      );
      expect(after.balanced).toBe(true);
    });

    it('counts nothing while the order is only placed', async () => {
      await order();
      const sheet = await balance();
      expect(sheet.goods_in_transit).toBe('0.00');
      expect(sheet.supplier_payable_total_kgs).toBe('0.00');
      expect(sheet.balanced).toBe(true);
    });
  });
});
