import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, fifo_layer_source } from '@prisma/client';
import request from 'supertest';
import { StockService } from '../src/stock/stock.service';
import { createTestApp } from './app-harness';
import { Module3Context, resetModule3 } from './module3-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('FIFO simulation and consumption (Module 4.5, §13.3, §18)', () => {
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

  async function anchorDocument(): Promise<string> {
    const { body } = await asOwner(http().post('/api/purchases'))
      .send({
        supplier_id: ctx.supplierId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00', price_cny: '1.00' }],
      })
      .expect(201);
    return body.id as string;
  }

  /** One LOT-like layer at a stated date and cost. */
  async function layer(params: {
    qty: string;
    unitCost: string;
    date: string;
    productIndex?: number;
    warehouseId?: string;
  }): Promise<string> {
    const documentId = await anchorDocument();
    const created = await prisma.$transaction((tx) =>
      stock.createLayer(tx, {
        productId: ctx.productIds[params.productIndex ?? 0],
        source: fifo_layer_source.PURCHASE,
        layerDate: new Date(`${params.date}T00:00:00Z`),
        unitCost: D(params.unitCost),
        qty: D(params.qty),
        warehouseId: params.warehouseId ?? ctx.mainWarehouse,
        documentId,
      }),
    );
    return created.id;
  }

  const plan = (qty: string, productIndex = 0) =>
    stock.simulateFifo(prisma, {
      productId: ctx.productIds[productIndex],
      warehouseId: ctx.mainWarehouse,
      qty: D(qty),
    });

  describe('§13.3 — the knowledge base example', () => {
    it('5 × 7 000 then 5 × 7 500, sell 10 → COGS 72 500 exactly', async () => {
      await layer({ qty: '5.00', unitCost: '7000.0000', date: '2026-08-01' });
      await layer({ qty: '5.00', unitCost: '7500.0000', date: '2026-08-10' });

      const result = await plan('10.00');

      expect(result.cogs.toFixed(2)).toBe('72500.00');
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].qty.toFixed(2)).toBe('5.00');
      expect(result.lines[0].unitCost.toFixed(4)).toBe('7000.0000');
      expect(result.lines[1].unitCost.toFixed(4)).toBe('7500.0000');
    });

    it('takes the older layer first whatever order they were created in', async () => {
      // The dearer layer is created first but dated later.
      const newer = await layer({ qty: '5.00', unitCost: '7500.0000', date: '2026-08-10' });
      const older = await layer({ qty: '5.00', unitCost: '7000.0000', date: '2026-08-01' });

      const result = await plan('6.00');

      expect(result.lines[0].layerId).toBe(older);
      expect(result.lines[1].layerId).toBe(newer);
      // 5 × 7 000 + 1 × 7 500.
      expect(result.cogs.toFixed(2)).toBe('42500.00');
    });

    it('does not average the layers (§18)', async () => {
      await layer({ qty: '10.00', unitCost: '7000.0000', date: '2026-08-01' });
      await layer({ qty: '10.00', unitCost: '8000.0000', date: '2026-08-05' });

      // An average would give 12 × 7 500 = 90 000. FIFO gives 10 × 7 000 +
      // 2 × 8 000 = 86 000.
      const result = await plan('12.00');
      expect(result.cogs.toFixed(2)).toBe('86000.00');
    });

    it('fills from one layer when it is big enough', async () => {
      await layer({ qty: '20.00', unitCost: '7000.0000', date: '2026-08-01' });
      const result = await plan('3.00');
      expect(result.lines).toHaveLength(1);
      expect(result.cogs.toFixed(2)).toBe('21000.00');
    });
  });

  describe('what it refuses', () => {
    it('refuses more than is in stock, saying how much there is', async () => {
      await layer({ qty: '8.00', unitCost: '7000.0000', date: '2026-08-01' });
      await expect(plan('10.00')).rejects.toThrow(/8\.00 гана бар/);
    });

    it('refuses when nothing is in stock', async () => {
      await expect(plan('1.00')).rejects.toThrow(/0\.00 гана бар/);
    });

    it('refuses a non-positive quantity', async () => {
      await layer({ qty: '5.00', unitCost: '100.0000', date: '2026-08-01' });
      await expect(plan('0.00')).rejects.toThrow(/positive quantity/);
    });

    it('counts only the warehouse asked about — DEFECT is not for sale', async () => {
      await layer({ qty: '5.00', unitCost: '100.0000', date: '2026-08-01' });
      await layer({
        qty: '5.00',
        unitCost: '100.0000',
        date: '2026-08-01',
        warehouseId: ctx.defectWarehouse,
      });

      // Ten are held in total; only the five in MAIN can be sold (§12-А.6).
      await expect(plan('6.00')).rejects.toThrow(/5\.00 гана бар/);
    });
  });

  describe('consumption uses the same code as the simulation', () => {
    it('takes exactly what the plan said, and leaves the right remainder', async () => {
      const first = await layer({ qty: '5.00', unitCost: '7000.0000', date: '2026-08-01' });
      const second = await layer({ qty: '5.00', unitCost: '7500.0000', date: '2026-08-10' });
      const documentId = await anchorDocument();

      const simulated = await plan('7.00');
      const consumed = await prisma.$transaction((tx) =>
        stock.consumeFifo(tx, {
          productId: ctx.productIds[0],
          warehouseId: ctx.mainWarehouse,
          qty: D('7.00'),
          documentId,
        }),
      );

      expect(consumed.cogs.equals(simulated.cogs)).toBe(true);
      expect(consumed.lines.map((l) => l.layerId)).toEqual(
        simulated.lines.map((l) => l.layerId),
      );

      expect(
        (await stock.onHand(prisma, first, ctx.mainWarehouse)).toFixed(2),
      ).toBe('0.00');
      expect(
        (await stock.onHand(prisma, second, ctx.mainWarehouse)).toFixed(2),
      ).toBe('3.00');
    });

    it('records a SALE_OUT movement per layer (§42.4)', async () => {
      await layer({ qty: '5.00', unitCost: '7000.0000', date: '2026-08-01' });
      await layer({ qty: '5.00', unitCost: '7500.0000', date: '2026-08-10' });
      const documentId = await anchorDocument();

      await prisma.$transaction((tx) =>
        stock.consumeFifo(tx, {
          productId: ctx.productIds[0],
          warehouseId: ctx.mainWarehouse,
          qty: D('7.00'),
          documentId,
        }),
      );

      const movements = await prisma.stock_movements.findMany({
        where: { document_id: documentId, mtype: 'SALE_OUT' },
        orderBy: { id: 'asc' },
      });
      expect(movements).toHaveLength(2);
      expect(movements.map((m) => m.qty.toFixed(2))).toEqual(['-5.00', '-2.00']);
    });

    it('leaves nothing behind when the stock runs out mid-way', async () => {
      await layer({ qty: '5.00', unitCost: '7000.0000', date: '2026-08-01' });
      const documentId = await anchorDocument();
      const before = await prisma.stock_movements.count();

      await expect(
        prisma.$transaction((tx) =>
          stock.consumeFifo(tx, {
            productId: ctx.productIds[0],
            warehouseId: ctx.mainWarehouse,
            qty: D('9.00'),
            documentId,
          }),
        ),
      ).rejects.toThrow();

      expect(await prisma.stock_movements.count()).toBe(before);
    });

    it('lets only one of two concurrent sales take the last unit', async () => {
      await layer({ qty: '1.00', unitCost: '7000.0000', date: '2026-08-01' });
      const documentId = await anchorDocument();

      const sell = () =>
        prisma
          .$transaction((tx) =>
            stock.consumeFifo(tx, {
              productId: ctx.productIds[0],
              warehouseId: ctx.mainWarehouse,
              qty: D('1.00'),
              documentId,
            }),
          )
          .then(
            () => 'sold' as const,
            () => 'refused' as const,
          );

      const results = await Promise.all([sell(), sell()]);

      expect(results.filter((r) => r === 'sold')).toHaveLength(1);
      expect(results.filter((r) => r === 'refused')).toHaveLength(1);

      const [entry] = await stock.stockByProduct({ productId: ctx.productIds[0] });
      expect(entry).toBeUndefined();
    });
  });
});
