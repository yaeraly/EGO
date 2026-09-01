import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { StockService } from '../src/stock/stock.service';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import {
  Module3Context,
  confirmedPurchase,
  resetModule3,
  setProductMeasurements,
} from './module3-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Receipt, landed cost and LOT (Module 3.4–3.7, §7, §9, §18.1)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stock: StockService;
  let ctx: Module3Context;

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
    ctx = await resetModule3(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);
  const flow = () => documentFlow(app, ctx.ownerToken);

  /** Opens a receipt against a fresh confirmed order. */
  async function openReceipt(params: {
    lines: { productIndex: number; qty: string; priceCny: string }[];
    buyCny?: { amount: string; rate: string };
  }): Promise<{ purchaseId: string; receiptId: string }> {
    const purchaseId = await confirmedPurchase(app, ctx, params);
    const { body } = await asOwner(http().post('/api/receipts'))
      .send({ purchase_id: purchaseId })
      .expect(201);
    return { purchaseId, receiptId: body.id as string };
  }

  const setRates = (receiptId: string, body: Record<string, unknown> = {}) =>
    asOwner(http().post(`/api/receipts/${receiptId}/rates`)).send(body);

  const problems = async (receiptId: string) =>
    (await asOwner(http().get(`/api/receipts/${receiptId}/problems`)).expect(200))
      .body as { code: string; sku?: string; message: string }[];

  const preview = (receiptId: string) =>
    asOwner(http().get(`/api/receipts/${receiptId}/preview`));

  describe('opening a receipt (§7)', () => {
    it('seeds every line from the order, received defaulting to ordered', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [
          { productIndex: 0, qty: '100.00', priceCny: '1000.00' },
          { productIndex: 1, qty: '20.00', priceCny: '500.00' },
        ],
      });

      const { body } = await asOwner(
        http().get(`/api/receipts/${receiptId}`),
      ).expect(200);

      expect(body.rstatus).toBe('DRAFT');
      expect(body.receipt_items).toHaveLength(2);
      expect(body.receipt_items[0].ordered_qty).toBe('100');
      expect(body.receipt_items[0].received_qty).toBe('100');
    });

    it('refuses an order that has not been confirmed', async () => {
      const { body: draft } = await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          items: [
            { product_id: ctx.productIds[0], qty: '1.00', price_cny: '10.00' },
          ],
        })
        .expect(201);

      await asOwner(http().post('/api/receipts'))
        .send({ purchase_id: draft.id })
        .expect(409);
    });

    it('refuses a second open receipt for the same order', async () => {
      const { purchaseId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });

      await asOwner(http().post('/api/receipts'))
        .send({ purchase_id: purchaseId })
        .expect(409);
    });
  });

  describe('§9.1 — a SKU with no weight blocks the receipt', () => {
    it('names the product and the field', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], {
        weightKg: null,
      });

      const found = await problems(receiptId);
      const weight = found.find((p) => p.code === 'MISSING_WEIGHT')!;
      expect(weight.sku).toBe(ctx.productSkus[0]);
      expect(weight.message).toMatch(/физикалык салмак жок/);
      expect(weight.message).toMatch(/§9\.1/);

      await asOwner(http().post(`/api/receipts/${receiptId}/ready`)).expect(409);
      await flow().confirm(receiptId).expect(409);
    });

    it('lets the receipt through once the weight is filled in', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], {
        weightKg: null,
      });
      await setRates(receiptId).expect(201);
      expect((await problems(receiptId)).length).toBeGreaterThan(0);

      await setProductMeasurements(prisma, ctx.productIds[0], {
        weightKg: '12.500',
      });
      expect(await problems(receiptId)).toEqual([]);
    });
  });

  describe('§9.4 — VOLUME without volume data blocks the receipt', () => {
    it('refuses and says which product is missing what', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({
          etype: 'INTL_CARGO',
          amount: '5000.00',
          currency: 'KGS',
          alloc_basis: 'VOLUME',
        })
        .expect(201);

      const found = await problems(receiptId);
      const volume = found.find((p) => p.code === 'MISSING_VOLUME')!;
      expect(volume.sku).toBe(ctx.productSkus[0]);
      expect(volume.message).toMatch(/көлөм\/chargeable weight жок/);
      expect(volume.message).toMatch(/§9\.4/);

      await flow().confirm(receiptId).expect(409);
    });

    it('passes once the chargeable weight is known', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({
          etype: 'INTL_CARGO',
          amount: '5000.00',
          currency: 'KGS',
          alloc_basis: 'VOLUME',
        })
        .expect(201);

      await setProductMeasurements(prisma, ctx.productIds[0], {
        chargeableWeightKg: '30.000',
      });
      expect(await problems(receiptId)).toEqual([]);
    });
  });

  describe('§9.6 — MANUAL must add up exactly', () => {
    it('blocks when the manual split is a tiyin short', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [
          { productIndex: 0, qty: '10.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '100.00' },
        ],
      });
      await setRates(receiptId).expect(201);

      const { body: receipt } = await asOwner(
        http().get(`/api/receipts/${receiptId}`),
      ).expect(200);
      const [first, second] = receipt.receipt_items;

      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({
          etype: 'OTHER',
          amount: '1000.00',
          currency: 'KGS',
          alloc_basis: 'MANUAL',
          manual_allocations: [
            { receipt_item_id: first.id, amount_kgs: '600.00' },
            { receipt_item_id: second.id, amount_kgs: '399.99' },
          ],
        })
        .expect(201);

      const found = await problems(receiptId);
      const mismatch = found.find((p) => p.code === 'MANUAL_SUM_MISMATCH')!;
      expect(mismatch.message).toMatch(/999\.99/);
      expect(mismatch.message).toMatch(/1000\.00/);
      await flow().confirm(receiptId).expect(409);
    });

    it('accepts a split that matches to the tiyin', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '13.00' },
        lines: [
          { productIndex: 0, qty: '10.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '100.00' },
        ],
      });
      await setRates(receiptId).expect(201);
      const { body: receipt } = await asOwner(
        http().get(`/api/receipts/${receiptId}`),
      ).expect(200);

      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({
          etype: 'OTHER',
          amount: '1000.00',
          currency: 'KGS',
          alloc_basis: 'MANUAL',
          manual_allocations: [
            { receipt_item_id: receipt.receipt_items[0].id, amount_kgs: '600.00' },
            { receipt_item_id: receipt.receipt_items[1].id, amount_kgs: '400.00' },
          ],
        })
        .expect(201);

      expect(await problems(receiptId)).toEqual([]);
      const { body: costed } = await preview(receiptId).expect(200);
      const byLine = new Map(
        costed.lines.map((l: { sku: string; allocated_total_kgs: string }) => [
          l.sku,
          l.allocated_total_kgs,
        ]),
      );
      expect(byLine.get(ctx.productSkus[0])).toBe('600.00');
      expect(byLine.get(ctx.productSkus[1])).toBe('400.00');
    });
  });

  describe('§9.3 and §9.7 — landed cost', () => {
    it('splits a weight-based expense 1 000 : 400 and derives the unit cost', async () => {
      // 10 kg × 5 pcs = 50 kg, and 2 kg × 10 pcs = 20 kg → 50 : 20 = 5 : 2,
      // so 1 400.00 KGS splits as 1 000.00 : 400.00.
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [
          { productIndex: 0, qty: '5.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '50.00' },
        ],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], { weightKg: '10.000' });
      await setProductMeasurements(prisma, ctx.productIds[1], { weightKg: '2.000' });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'CHINA_TRANSPORT', amount: '1400.00', currency: 'KGS' })
        .expect(201);

      const { body } = await preview(receiptId).expect(200);
      const byLine = new Map<string, Record<string, string>>(
        body.lines.map((l: Record<string, string>) => [l.sku, l]),
      );

      const motor = byLine.get(ctx.productSkus[0])!;
      expect(motor.total_weight_kg).toBe('50.000');
      expect(motor.allocated_total_kgs).toBe('1000.00');
      // 5 × 100 CNY × 10.00 = 5 000 KGS purchase cost.
      expect(motor.purchase_cost_kgs).toBe('5000.00');
      expect(motor.total_landed_cost_kgs).toBe('6000.00');
      // §9.7: 6 000 ÷ 5 = 1 200.0000 per unit.
      expect(motor.unit_landed_cost).toBe('1200.0000');

      const battery = byLine.get(ctx.productSkus[1])!;
      expect(battery.allocated_total_kgs).toBe('400.00');
      expect(battery.purchase_cost_kgs).toBe('5000.00');
      expect(battery.unit_landed_cost).toBe('540.0000');
    });

    it('splits 50 : 40 as 777.78 : 622.22, exactly (§9.9)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [
          { productIndex: 0, qty: '5.00', priceCny: '100.00' },
          { productIndex: 1, qty: '20.00', priceCny: '50.00' },
        ],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], { weightKg: '10.000' });
      await setProductMeasurements(prisma, ctx.productIds[1], { weightKg: '2.000' });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'CHINA_TRANSPORT', amount: '1400.00', currency: 'KGS' })
        .expect(201);

      const { body } = await preview(receiptId).expect(200);
      const allocated = body.lines.map((l: { allocated_total_kgs: string }) =>
        new Prisma.Decimal(l.allocated_total_kgs).toFixed(2),
      );
      expect(allocated.sort()).toEqual(['622.22', '777.78']);
      expect(
        allocated
          .reduce((a: Prisma.Decimal, b: string) => a.plus(b), D('0'))
          .toFixed(2),
      ).toBe('1400.00');
    });

    it('carries several expenses, each on its own basis (§9.2)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [
          { productIndex: 0, qty: '5.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '50.00' },
        ],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], { weightKg: '10.000' });
      await setProductMeasurements(prisma, ctx.productIds[1], { weightKg: '2.000' });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'CHINA_TRANSPORT', amount: '1400.00', currency: 'KGS' })
        .expect(201);
      // Insurance follows value, not weight — both lines are worth 5 000.
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({
          etype: 'INSURANCE',
          amount: '500.00',
          currency: 'KGS',
          alloc_basis: 'VALUE',
        })
        .expect(201);

      const { body } = await preview(receiptId).expect(200);
      const byLine = new Map<string, Record<string, string>>(
        body.lines.map((l: Record<string, string>) => [l.sku, l]),
      );
      // 1 000 by weight + 250 by value.
      expect(byLine.get(ctx.productSkus[0])!.allocated_total_kgs).toBe('1250.00');
      expect(byLine.get(ctx.productSkus[1])!.allocated_total_kgs).toBe('650.00');
      expect(body.total_landed_cost_kgs).toBe('11900.00');
    });

    it('converts a foreign-currency expense at its own recorded rate (§10.1)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);

      const { body: expense } = await asOwner(
        http().post(`/api/receipts/${receiptId}/expenses`),
      )
        .send({
          etype: 'INTL_CARGO',
          amount: '300.00',
          currency: 'USD',
          rate: '87.000000',
          rate_source: 'MANUAL',
        })
        .expect(201);

      expect(expense.kgs_amount).toBe('26100');
      expect(expense.rate_source).toBe('MANUAL');

      const { body } = await preview(receiptId).expect(200);
      expect(body.lines[0].allocated_total_kgs).toBe('26100.00');
    });
  });

  describe('§8.1 — only what arrived is costed', () => {
    it('books 90 of 100 at 90 000 and leaves the missing 10 000 out', async () => {
      // The knowledge base's own example (§8.1), at a rate of 1.00 so the
      // som figures are the ones it quotes.
      const { receiptId } = await openReceipt({
        buyCny: { amount: '200000.00', rate: '1.00' },
        lines: [{ productIndex: 0, qty: '100.00', priceCny: '1000.00' }],
      });
      await setRates(receiptId, { rate_cny: '1.000000' }).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({
          lines: [{ product_id: ctx.productIds[0], received_qty: '90.00' }],
        })
        .expect(201);

      const { body } = await preview(receiptId).expect(200);
      expect(body.lines[0].purchase_cost_kgs).toBe('90000.00');
      // 90 000 ÷ 90 = 1 000 — the missing ten do not inflate the rest.
      expect(body.lines[0].unit_landed_cost).toBe('1000.0000');
      expect(body.total_landed_cost_kgs).toBe('90000.00');
    });

    it('puts 90 into stock at 1 000 each and raises a DIF', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '200000.00', rate: '1.00' },
        lines: [{ productIndex: 0, qty: '100.00', priceCny: '1000.00' }],
      });
      await setRates(receiptId, { rate_cny: '1.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({ lines: [{ product_id: ctx.productIds[0], received_qty: '90.00' }] })
        .expect(201);

      await flow().confirm(receiptId).expect(201);

      const [entry] = await stock.stockByProduct({ productId: ctx.productIds[0] });
      expect(entry.current_qty).toBe('90.00');
      expect(entry.total_value_kgs).toBe('90000.00');

      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);
      expect(difs).toHaveLength(1);
      expect(difs[0].ordered_qty).toBe('100');
      expect(difs[0].received_qty).toBe('90');
      expect(difs[0].diff_qty).toBe('-10');
      expect(difs[0].dtype).toBe('UNKNOWN');
      expect(difs[0].dstatus).toBe('OPEN');
    });

    it('does not reload the freight of goods that never arrived (§8.6)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '200000.00', rate: '1.00' },
        lines: [
          { productIndex: 0, qty: '10.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '100.00' },
        ],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], { weightKg: '1.000' });
      await setProductMeasurements(prisma, ctx.productIds[1], { weightKg: '1.000' });
      await setRates(receiptId, { rate_cny: '1.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'INTL_CARGO', amount: '1000.00', currency: 'KGS' })
        .expect(201);

      // The whole second line was lost in transit.
      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({
          lines: [
            { product_id: ctx.productIds[0], received_qty: '10.00' },
            { product_id: ctx.productIds[1], received_qty: '0.00' },
          ],
        })
        .expect(201);

      const { body } = await preview(receiptId).expect(200);
      const byLine = new Map<string, Record<string, string>>(
        body.lines.map((l: Record<string, string>) => [l.sku, l]),
      );
      // The freight lands on what arrived. What the lost goods cost is a
      // claim (§8.5), not a cost added to their neighbours' shelf price.
      expect(byLine.get(ctx.productSkus[0])!.allocated_total_kgs).toBe('1000.00');
      expect(byLine.get(ctx.productSkus[1])!.allocated_total_kgs).toBe('0.00');
      expect(byLine.get(ctx.productSkus[1])!.unit_landed_cost).toBe('0.0000');
    });
  });

  describe('confirming (§18.1)', () => {
    it('creates a LOT, its items and one FIFO layer per line', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [
          { productIndex: 0, qty: '5.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '50.00' },
        ],
      });
      await setProductMeasurements(prisma, ctx.productIds[0], { weightKg: '10.000' });
      await setProductMeasurements(prisma, ctx.productIds[1], { weightKg: '2.000' });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'CHINA_TRANSPORT', amount: '1400.00', currency: 'KGS' })
        .expect(201);

      await flow().confirm(receiptId).expect(201);

      const lot = await prisma.lots.findFirst({
        where: { receipt_id: receiptId },
        include: { lot_items: true, documents: true },
      });
      expect(lot).not.toBeNull();
      expect(lot!.documents.doc_number).toMatch(/^LOT-\d{4}-\d{6}$/);
      expect(lot!.total_weight_kg!.toFixed(3)).toBe('70.000');
      expect(lot!.total_landed_cost_kgs!.toFixed(2)).toBe('11400.00');
      expect(lot!.lot_items).toHaveLength(2);

      const layers = await prisma.fifo_layers.findMany({
        where: { source_doc_id: receiptId },
      });
      expect(layers).toHaveLength(2);
      for (const layer of layers) {
        expect(layer.source).toBe('PURCHASE');
        expect(layer.lot_item_id).not.toBeNull();
      }

      const motorLayer = layers.find(
        (l) => l.product_id === ctx.productIds[0],
      )!;
      expect(motorLayer.unit_cost.toFixed(4)).toBe('1200.0000');
      expect(motorLayer.initial_qty.toFixed(2)).toBe('5.00');
    });

    it('records every allocation, summing to each expense (§9.9)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [
          { productIndex: 0, qty: '10.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '100.00' },
          { productIndex: 2, qty: '10.00', priceCny: '100.00' },
        ],
      });
      for (const id of ctx.productIds) {
        await setProductMeasurements(prisma, id, { weightKg: '1.000' });
      }
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'CHINA_TRANSPORT', amount: '1000.00', currency: 'KGS' })
        .expect(201);

      await flow().confirm(receiptId).expect(201);

      const allocations = await prisma.expense_allocations.findMany();
      expect(allocations).toHaveLength(3);
      const total = allocations.reduce((sum, row) => sum.plus(row.amount_kgs), D('0'));
      expect(total.toFixed(2)).toBe('1000.00');
      // §9.9's example, through the whole stack.
      expect(
        allocations.map((a) => a.amount_kgs.toFixed(2)).sort(),
      ).toEqual(['333.33', '333.33', '333.34']);
    });

    it('creates no layer for a line that received nothing', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [
          { productIndex: 0, qty: '10.00', priceCny: '100.00' },
          { productIndex: 1, qty: '10.00', priceCny: '100.00' },
        ],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({
          lines: [
            { product_id: ctx.productIds[0], received_qty: '10.00' },
            { product_id: ctx.productIds[1], received_qty: '0.00' },
          ],
        })
        .expect(201);

      await flow().confirm(receiptId).expect(201);

      const layers = await prisma.fifo_layers.findMany({
        where: { source_doc_id: receiptId },
      });
      expect(layers).toHaveLength(1);
      expect(layers[0].product_id).toBe(ctx.productIds[0]);

      // The LOT item still exists — §8 needs it on record.
      const lot = await prisma.lots.findFirst({
        where: { receipt_id: receiptId },
        include: { lot_items: true },
      });
      expect(lot!.lot_items).toHaveLength(2);
    });

    it('goods are not stock until the receipt is confirmed (§18.1.6.1)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);

      expect(await stock.stockByProduct({ productId: ctx.productIds[0] })).toEqual([]);

      await flow().confirm(receiptId).expect(201);
      const [entry] = await stock.stockByProduct({ productId: ctx.productIds[0] });
      expect(entry.available_qty).toBe('10.00');
    });
  });

  describe('§8.4 — damaged goods go to DEFECT at the same cost', () => {
    it('splits 10 into 8 MAIN and 2 DEFECT, both at one unit cost', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'CHINA_TRANSPORT', amount: '2000.00', currency: 'KGS' })
        .expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({
          lines: [
            {
              product_id: ctx.productIds[0],
              received_qty: '10.00',
              damaged_qty: '2.00',
            },
          ],
        })
        .expect(201);

      await flow().confirm(receiptId).expect(201);

      // 10 × 100 × 10.00 = 10 000, plus 2 000 freight = 12 000 ÷ 10 = 1 200.
      const layers = await prisma.fifo_layers.findMany({
        where: { source_doc_id: receiptId },
      });
      expect(layers).toHaveLength(1);
      expect(layers[0].unit_cost.toFixed(4)).toBe('1200.0000');

      const [entry] = await stock.stockByProduct({ productId: ctx.productIds[0] });
      expect(entry.current_qty).toBe('10.00');
      // The two damaged are held but not for sale (§12-А.6).
      expect(entry.available_qty).toBe('8.00');

      const byCode = new Map(entry.by_warehouse.map((w) => [w.code, w]));
      expect(byCode.get('MAIN')!.qty).toBe('8.00');
      expect(byCode.get('DEFECT')!.qty).toBe('2.00');
      // Same cost on both sides — they were paid for and shipped alike.
      expect(byCode.get('MAIN')!.value_kgs).toBe('9600.00');
      expect(byCode.get('DEFECT')!.value_kgs).toBe('2400.00');
    });

    it('raises a RECEIVING_DAMAGE discrepancy for them (§8.4)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({
          lines: [
            {
              product_id: ctx.productIds[0],
              received_qty: '10.00',
              damaged_qty: '2.00',
            },
          ],
        })
        .expect(201);

      await flow().confirm(receiptId).expect(201);

      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);
      expect(difs).toHaveLength(1);
      expect(difs[0].dtype).toBe('RECEIVING_DAMAGE');
      expect(difs[0].diff_qty).toBe('-2');
    });

    it('refuses more damage than was received', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });

      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({
          lines: [
            {
              product_id: ctx.productIds[0],
              received_qty: '5.00',
              damaged_qty: '6.00',
            },
          ],
        })
        .expect(400);
    });
  });

  describe('§27.1 and §18.1.6.3 — a confirmed receipt does not change', () => {
    it('refuses to change the quantities afterwards', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await flow().confirm(receiptId).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/lines`))
        .send({ lines: [{ product_id: ctx.productIds[0], received_qty: '99.00' }] })
        .expect(409);
    });

    it('refuses to add or remove an expense afterwards', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await flow().confirm(receiptId).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/expenses`))
        .send({ etype: 'OTHER', amount: '100.00', currency: 'KGS' })
        .expect(409);
    });

    it('records the rejection in the audit log', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await flow().confirm(receiptId).expect(201);

      await asOwner(http().post(`/api/receipts/${receiptId}/rates`))
        .send({ rate_cny: '1.000000' })
        .expect(409);

      const rejected = await prisma.audit_log.findFirst({
        where: { action: 'RECEIPT_UPDATE_REJECTED', document_id: receiptId },
      });
      expect(rejected).not.toBeNull();
    });

    it('leaves the fixed unit cost alone (§18.1.6.4)', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await flow().confirm(receiptId).expect(201);

      const before = await prisma.fifo_layers.findFirst({
        where: { source_doc_id: receiptId },
      });

      // A later rate change cannot reach back into a fixed cost.
      await asOwner(http().post(`/api/receipts/${receiptId}/rates`))
        .send({ rate_cny: '99.000000' })
        .expect(409);

      const after = await prisma.fifo_layers.findFirst({
        where: { source_doc_id: receiptId },
      });
      expect(after!.unit_cost.equals(before!.unit_cost)).toBe(true);
    });

    it('refuses to confirm the same receipt twice', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });
      await setRates(receiptId, { rate_cny: '10.000000' }).expect(201);
      await flow().confirm(receiptId).expect(201);
      await flow().confirm(receiptId).expect(409);
    });
  });

  describe('who may do what', () => {
    it('lets warehouse staff receive goods but not override a rate', async () => {
      const { receiptId } = await openReceipt({
        buyCny: { amount: '20000.00', rate: '10.00' },
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '100.00' }],
      });

      await asStaff(http().post(`/api/receipts/${receiptId}/lines`))
        .send({ lines: [{ product_id: ctx.productIds[0], received_qty: '9.00' }] })
        .expect(201);

      await asStaff(http().post(`/api/receipts/${receiptId}/rates`))
        .send({ rate_cny: '1.000000' })
        .expect(403);
    });
  });
});
