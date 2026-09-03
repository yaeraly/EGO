import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { buyCurrency, documentFlow } from './module2-harness';
import { Module3Context, confirmedPurchase, resetModule3 } from './module3-harness';

describe('Prepayment applied at receipt (Module 3.7, §4.3, §10.2)', () => {
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
  const flow = () => documentFlow(app, ctx.ownerToken);

  const buyCny = (amount: string, rate: string) =>
    buyCurrency(app, ctx, {
      kgs: new Prisma.Decimal(amount).times(rate).toFixed(2),
      foreign: amount,
      toAccount: ctx.cnyAccount,
    });

  const pay = (amountCny: string, purchaseId?: string) =>
    flow().createAndConfirm('/api/supplier-payments', {
      supplier_id: ctx.supplierId,
      from_account: ctx.cnyAccount,
      amount_cny: amountCny,
      ...(purchaseId ? { purchase_id: purchaseId } : {}),
    });

  const entries = () =>
    prisma.supplier_ledger.findMany({
      where: { supplier_id: ctx.supplierId },
      orderBy: { id: 'asc' },
    });

  const sumOf = async (entryType: string): Promise<string> =>
    (await entries())
      .filter((e) => e.entry_type === entryType)
      .reduce((sum, e) => sum.plus(e.amount_cny), new Prisma.Decimal(0))
      .toFixed(2);

  /** Receives a confirmed order in full, at the rate given. */
  async function receiveInFull(
    purchaseId: string,
    rateCny: string,
  ): Promise<string> {
    const { body: receipt } = await asOwner(http().post('/api/receipts'))
      .send({ purchase_id: purchaseId })
      .expect(201);
    await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
      .send({ rate_cny: rateCny })
      .expect(201);
    await flow().confirm(receipt.id).expect(201);
    return receipt.id as string;
  }

  it('applies a 2 000 CNY advance to a 5 000 CNY payable, leaving 3 000', async () => {
    // The acceptance criterion, step by step.
    await buyCny('20000.00', '13.00');

    // An advance with nothing to apply it to yet.
    await pay('2000.00');
    expect(await sumOf('PREPAYMENT')).toBe('2000.00');

    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '50.00', priceCny: '100.00' }],
    });

    const receiptId = await receiveInFull(purchaseId, '13.000000');

    // The advance is spent and the debt it settles is released.
    expect(await sumOf('PREPAYMENT')).toBe('2000.00');
    expect(await sumOf('PREPAYMENT_APPLY')).toBe('-2000.00');

    const { body: ledger } = await asOwner(
      http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
    ).expect(200);
    // 5 000 owed, less the 2 000 advance.
    expect(ledger.we_owe_cny).toBe('3000.00');

    const applied = (await entries()).filter(
      (e) => e.document_id === receiptId,
    );
    expect(applied.map((e) => e.entry_type).sort()).toEqual([
      'PAYMENT',
      'PREPAYMENT_APPLY',
    ]);
  });

  it('leaves the advance at zero once it is used up', async () => {
    await buyCny('20000.00', '13.00');
    await pay('2000.00');

    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '50.00', priceCny: '100.00' }],
    });
    await receiveInFull(purchaseId, '13.000000');

    const prepayStream = (await entries()).filter(
      (e) =>
        e.entry_type === 'PREPAYMENT' || e.entry_type === 'PREPAYMENT_APPLY',
    );
    const remaining = prepayStream.reduce(
      (sum, e) => sum.plus(e.amount_cny),
      new Prisma.Decimal(0),
    );
    expect(remaining.toFixed(2)).toBe('0.00');
  });

  it('computes the exchange result on the advance (§10.2)', async () => {
    // The advance is bought at 13.00 and the payable is recognised at 14.00,
    // so settling 2 000 CNY of debt booked at 28 000 with an advance that
    // cost 26 000 is a 2 000 KGS gain.
    await buyCny('2000.00', '13.00');
    await pay('2000.00');
    // A later, dearer purchase moves the reference rate to 14.00.
    await buyCny('10000.00', '14.00');

    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '50.00', priceCny: '100.00' }],
    });
    const receiptId = await receiveInFull(purchaseId, '14.000000');

    const applied = (await entries()).filter((e) => e.document_id === receiptId);
    const spend = applied.find((e) => e.entry_type === 'PREPAYMENT_APPLY')!;
    const release = applied.find((e) => e.entry_type === 'PAYMENT')!;

    // The advance leaves at what it cost; the debt at what it was booked at.
    expect(spend.kgs_value!.toFixed(2)).toBe('-26000.00');
    expect(release.kgs_value!.toFixed(2)).toBe('28000.00');

    const audit = await prisma.audit_log.findFirst({
      where: { action: 'RECEIPT_CONFIRMED', document_id: receiptId },
    });
    expect(audit!.new_value).toMatchObject({
      prepayment_applied_cny: '2000.00',
      prepayment_fx_kgs: '2000.00',
    });
  });

  it('does not touch the landed cost with that exchange result (§18.1.6.4)', async () => {
    await buyCny('2000.00', '13.00');
    await pay('2000.00');
    await buyCny('10000.00', '14.00');

    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '50.00', priceCny: '100.00' }],
    });
    const receiptId = await receiveInFull(purchaseId, '14.000000');

    const lot = await prisma.lots.findFirst({
      where: { receipt_id: receiptId },
      include: { lot_items: true },
    });
    // 50 × 100 CNY × 14.00 = 70 000 ÷ 50 = 1 400. The 2 000 KGS gain is a
    // financial result, not part of what the motors cost.
    expect(lot!.lot_items[0].unit_landed_cost.toFixed(4)).toBe('1400.0000');
    expect(lot!.total_landed_cost_kgs!.toFixed(2)).toBe('70000.00');
  });

  it('applies only as much advance as there is debt', async () => {
    await buyCny('20000.00', '13.00');
    await pay('5000.00');

    // A smaller order than the advance covers.
    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
    });
    await receiveInFull(purchaseId, '13.000000');

    expect(await sumOf('PREPAYMENT_APPLY')).toBe('-1000.00');

    const { body: ledger } = await asOwner(
      http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
    ).expect(200);
    // The debt is gone and 4 000 of advance remains.
    expect(ledger.we_owe_cny).toBe('0.00');
    expect(ledger.balance_cny).toBe('4000.00');
  });

  it('does nothing when the supplier holds no advance', async () => {
    await buyCny('20000.00', '13.00');
    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
    });
    const receiptId = await receiveInFull(purchaseId, '13.000000');

    const applied = (await entries()).filter((e) => e.document_id === receiptId);
    expect(applied).toEqual([]);

    const audit = await prisma.audit_log.findFirst({
      where: { action: 'RECEIPT_CONFIRMED', document_id: receiptId },
    });
    expect(audit!.new_value).toMatchObject({
      prepayment_applied_cny: '0.00',
    });
  });

  it('treats money paid before the goods ship as an advance (§6.1)', async () => {
    await buyCny('20000.00', '13.00');

    const purchaseId = await confirmedPurchase(app, ctx, {
      lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
    });
    // Both payments happen while the order is still being gathered, so there
    // is no debt for either of them to close — an order is not a debt (§6.1).
    await pay('1000.00', purchaseId);
    await pay('500.00');
    expect(await sumOf('PREPAYMENT')).toBe('1500.00');
    expect(await sumOf('PAYABLE')).toBe('0.00');

    await receiveInFull(purchaseId, '13.000000');

    // The receipt is proof the goods shipped: the 1 000 debt appears and the
    // advance meets it, leaving the other 500 where it was.
    expect(await sumOf('PAYABLE')).toBe('-1000.00');
    expect(await sumOf('PREPAYMENT_APPLY')).toBe('-1000.00');
    const { body: ledger } = await asOwner(
      http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
    ).expect(200);
    expect(ledger.we_owe_cny).toBe('0.00');
    expect(ledger.balance_cny).toBe('500.00');
  });
});
