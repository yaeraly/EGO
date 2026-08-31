import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, fifo_layer_source, stock_movement_type } from '@prisma/client';
import request from 'supertest';
import { StockService } from '../src/stock/stock.service';
import { createTestApp } from './app-harness';
import { Module3Context, resetModule3 } from './module3-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Warehouses and stock (Module 3.1 and 3.2, §12-А, §42.4–5)', () => {
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

  /**
   * A document to hang movements on — every stock movement belongs to one
   * (§42.4), so the tests use a real confirmed purchase.
   */
  async function anchorDocument(): Promise<string> {
    const { body } = await asOwner(http().post('/api/purchases'))
      .send({
        supplier_id: ctx.supplierId,
        items: [
          { product_id: ctx.productIds[0], qty: '1.00', price_cny: '1.00' },
        ],
      })
      .expect(201);
    return body.id as string;
  }

  async function layerWith(params: {
    productIndex?: number;
    qty: string;
    unitCost: string;
    warehouseId?: string;
    documentId?: string;
  }): Promise<string> {
    const documentId = params.documentId ?? (await anchorDocument());
    const layer = await prisma.$transaction((tx) =>
      stock.createLayer(tx, {
        productId: ctx.productIds[params.productIndex ?? 0],
        source: fifo_layer_source.PURCHASE,
        layerDate: new Date('2026-08-01T00:00:00Z'),
        unitCost: D(params.unitCost),
        qty: D(params.qty),
        warehouseId: params.warehouseId ?? ctx.mainWarehouse,
        documentId,
      }),
    );
    return layer.id;
  }

  describe('warehouses (§12-А.1)', () => {
    it('are created by the OWNER and read by everyone', async () => {
      const { body } = await asStaff(http().get('/api/warehouses')).expect(200);
      expect(body.map((w: { code: string }) => w.code).sort()).toEqual([
        'DEFECT',
        'MAIN',
        'SERVICE',
      ]);

      await asStaff(http().post('/api/warehouses'))
        .send({ code: 'X1', name: 'Nope', wtype: 'OTHER' })
        .expect(403);
    });

    it('refuse a duplicate code (§12-А.1)', async () => {
      await asOwner(http().post('/api/warehouses'))
        .send({ code: 'MAIN', name: 'Дубль', wtype: 'MAIN' })
        .expect(409);
    });

    it('store the code upper-case', async () => {
      const { body } = await asOwner(http().post('/api/warehouses'))
        .send({ code: 'osh', name: 'Ош филиалы', wtype: 'BRANCH' })
        .expect(201);
      expect(body.code).toBe('OSH');
    });

    it('refuse new movement once inactive (§12-А.8.7)', async () => {
      const { body: temp } = await asOwner(http().post('/api/warehouses'))
        .send({ code: 'TMP', name: 'Убактылуу', wtype: 'OTHER' })
        .expect(201);

      await asOwner(http().patch(`/api/warehouses/${temp.id}`))
        .send({ is_active: false })
        .expect(200);

      const documentId = await anchorDocument();
      await expect(
        prisma.$transaction((tx) =>
          stock.createLayer(tx, {
            productId: ctx.productIds[0],
            source: fifo_layer_source.PURCHASE,
            layerDate: new Date(),
            unitCost: D('100.0000'),
            qty: D('1.00'),
            warehouseId: temp.id,
            documentId,
          }),
        ),
      ).rejects.toThrow(/inactive/);
    });

    it('cannot be deactivated while they still hold stock', async () => {
      await layerWith({ qty: '5.00', unitCost: '100.0000' });

      await asOwner(http().patch(`/api/warehouses/${ctx.mainWarehouse}`))
        .send({ is_active: false })
        .expect(409);
    });

    it('never let MAIN be deactivated — a receipt would have nowhere to land', async () => {
      const { body } = await asOwner(
        http().patch(`/api/warehouses/${ctx.mainWarehouse}`),
      )
        .send({ is_active: false })
        .expect(400);
      expect(body.message).toMatch(/MAIN/);
    });
  });

  describe('every movement belongs to a document (§42.4)', () => {
    it('writes a stock_movements row for each change', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({
        qty: '10.00',
        unitCost: '7500.0000',
        documentId,
      });

      const movements = await prisma.stock_movements.findMany({
        where: { layer_id: layerId },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].document_id).toBe(documentId);
      expect(movements[0].mtype).toBe(stock_movement_type.RECEIPT_IN);
      expect(movements[0].qty.toFixed(2)).toBe('10.00');
      expect(movements[0].unit_cost.toFixed(4)).toBe('7500.0000');
    });

    it('records a removal as a negative movement', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({ qty: '10.00', unitCost: '7500.0000' });

      await prisma.$transaction((tx) =>
        stock.removeFromWarehouse(tx, {
          layerId,
          warehouseId: ctx.mainWarehouse,
          qty: D('3.00'),
          documentId,
          movementType: stock_movement_type.TRANSFER_OUT,
        }),
      );

      const movements = await prisma.stock_movements.findMany({
        where: { layer_id: layerId },
        orderBy: { id: 'asc' },
      });
      expect(movements).toHaveLength(2);
      expect(movements[1].qty.toFixed(2)).toBe('-3.00');
      expect(
        (await stock.onHand(prisma, layerId, ctx.mainWarehouse)).toFixed(2),
      ).toBe('7.00');
    });

    it('balance is always the sum of movements, never a stored total', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({ qty: '10.00', unitCost: '100.0000' });
      await prisma.$transaction((tx) =>
        stock.removeFromWarehouse(tx, {
          layerId,
          warehouseId: ctx.mainWarehouse,
          qty: D('4.00'),
          documentId,
          movementType: stock_movement_type.SALE_OUT,
        }),
      );

      const movements = await prisma.stock_movements.findMany({
        where: { layer_id: layerId, warehouse_id: ctx.mainWarehouse },
      });
      const fromMovements = movements.reduce(
        (sum, m) => sum.plus(m.qty),
        new Prisma.Decimal(0),
      );
      const stored = await stock.onHand(prisma, layerId, ctx.mainWarehouse);
      expect(stored.equals(fromMovements)).toBe(true);
    });
  });

  describe('stock never goes negative (§42.5, §12-А.8.8)', () => {
    it('refuses to take out more than is there', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({ qty: '5.00', unitCost: '100.0000' });

      await expect(
        prisma.$transaction((tx) =>
          stock.removeFromWarehouse(tx, {
            layerId,
            warehouseId: ctx.mainWarehouse,
            qty: D('6.00'),
            documentId,
            movementType: stock_movement_type.SALE_OUT,
          }),
        ),
      ).rejects.toThrow(/cannot go negative/);

      expect(
        (await stock.onHand(prisma, layerId, ctx.mainWarehouse)).toFixed(2),
      ).toBe('5.00');
    });

    it('leaves nothing behind when it refuses — the transaction rolls back', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({ qty: '5.00', unitCost: '100.0000' });
      const before = await prisma.stock_movements.count();

      await expect(
        prisma.$transaction(async (tx) => {
          await stock.removeFromWarehouse(tx, {
            layerId,
            warehouseId: ctx.mainWarehouse,
            qty: D('2.00'),
            documentId,
            movementType: stock_movement_type.SALE_OUT,
          });
          // The second one is impossible; the first must not survive it.
          await stock.removeFromWarehouse(tx, {
            layerId,
            warehouseId: ctx.mainWarehouse,
            qty: D('4.00'),
            documentId,
            movementType: stock_movement_type.SALE_OUT,
          });
        }),
      ).rejects.toThrow();

      expect(await prisma.stock_movements.count()).toBe(before);
      expect(
        (await stock.onHand(prisma, layerId, ctx.mainWarehouse)).toFixed(2),
      ).toBe('5.00');
    });

    it('refuses a warehouse that never held the layer', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({ qty: '5.00', unitCost: '100.0000' });

      await expect(
        prisma.$transaction((tx) =>
          stock.removeFromWarehouse(tx, {
            layerId,
            warehouseId: ctx.serviceWarehouse,
            qty: D('1.00'),
            documentId,
            movementType: stock_movement_type.SALE_OUT,
          }),
        ),
      ).rejects.toThrow(/not enough/);
    });

    it('the database refuses a negative quantity even if the service is bypassed', async () => {
      const layerId = await layerWith({ qty: '5.00', unitCost: '100.0000' });

      // §42.5 as a column CHECK, not only as application discipline.
      await expect(
        prisma.$executeRaw`
          UPDATE layer_stock SET qty = -1
          WHERE layer_id = ${layerId}::uuid
        `,
      ).rejects.toThrow();
    });

    it('serialises two concurrent removals rather than overselling', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({ qty: '10.00', unitCost: '100.0000' });

      const take = (qty: string) =>
        prisma
          .$transaction((tx) =>
            stock.removeFromWarehouse(tx, {
              layerId,
              warehouseId: ctx.mainWarehouse,
              qty: D(qty),
              documentId,
              movementType: stock_movement_type.SALE_OUT,
            }),
          )
          .then(
            () => 'ok' as const,
            () => 'refused' as const,
          );

      const results = await Promise.all([take('6.00'), take('6.00')]);

      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      expect(results.filter((r) => r === 'refused')).toHaveLength(1);
      expect(
        (await stock.onHand(prisma, layerId, ctx.mainWarehouse)).toFixed(2),
      ).toBe('4.00');
    });
  });

  describe('stock views (§12-А.2, §28)', () => {
    it('reports Current, Reserved and Available per product', async () => {
      await layerWith({ qty: '10.00', unitCost: '7500.0000' });

      const [entry] = await stock.stockByProduct({
        productId: ctx.productIds[0],
      });
      expect(entry.current_qty).toBe('10.00');
      expect(entry.reserved_qty).toBe('0.00');
      expect(entry.available_qty).toBe('10.00');
      expect(entry.total_value_kgs).toBe('75000.00');
    });

    it('keeps DEFECT out of Available (§12-А.6)', async () => {
      const documentId = await anchorDocument();
      const layerId = await layerWith({
        qty: '10.00',
        unitCost: '7500.0000',
        documentId,
      });

      await prisma.$transaction(async (tx) => {
        await stock.removeFromWarehouse(tx, {
          layerId,
          warehouseId: ctx.mainWarehouse,
          qty: D('2.00'),
          documentId,
          movementType: stock_movement_type.TRANSFER_OUT,
        });
        await stock.addToWarehouse(tx, {
          layerId,
          warehouseId: ctx.defectWarehouse,
          qty: D('2.00'),
          documentId,
          movementType: stock_movement_type.TRANSFER_IN,
        });
      });

      const [entry] = await stock.stockByProduct({
        productId: ctx.productIds[0],
      });
      // Ten are physically held; only the eight in MAIN can be sold.
      expect(entry.current_qty).toBe('10.00');
      expect(entry.available_qty).toBe('8.00');
      expect(entry.total_value_kgs).toBe('75000.00');

      const defect = entry.by_warehouse.find((w) => w.wtype === 'DEFECT')!;
      expect(defect.qty).toBe('2.00');
      expect(defect.value_kgs).toBe('15000.00');
    });

    it('values each warehouse separately (§28)', async () => {
      await layerWith({ qty: '4.00', unitCost: '1000.0000' });
      await layerWith({
        qty: '3.00',
        unitCost: '2000.0000',
        warehouseId: ctx.serviceWarehouse,
      });

      const [entry] = await stock.stockByProduct({
        productId: ctx.productIds[0],
      });
      const byCode = new Map(entry.by_warehouse.map((w) => [w.code, w]));
      expect(byCode.get('MAIN')!.value_kgs).toBe('4000.00');
      expect(byCode.get('SERVICE')!.value_kgs).toBe('6000.00');
      expect(entry.total_value_kgs).toBe('10000.00');
    });

    it('lists the layers of one product with their own costs (§18.1.3)', async () => {
      await layerWith({ qty: '10.00', unitCost: '7000.0000' });
      await layerWith({ qty: '10.00', unitCost: '7500.0000' });

      const { body } = await asOwner(
        http().get(`/api/stock/products/${ctx.productIds[0]}/layers`),
      ).expect(200);

      expect(body).toHaveLength(2);
      expect(body.map((l: { unit_cost: string }) => l.unit_cost).sort()).toEqual(
        ['7000.0000', '7500.0000'],
      );
      // The system does not average them (§18).
      expect(body[0].value_kgs).toBe('70000.00');
    });

    it('orders available layers oldest first (§18)', async () => {
      const documentId = await anchorDocument();
      const newer = await prisma.$transaction((tx) =>
        stock.createLayer(tx, {
          productId: ctx.productIds[0],
          source: fifo_layer_source.PURCHASE,
          layerDate: new Date('2026-08-20T00:00:00Z'),
          unitCost: D('8000.0000'),
          qty: D('5.00'),
          warehouseId: ctx.mainWarehouse,
          documentId,
        }),
      );
      const older = await prisma.$transaction((tx) =>
        stock.createLayer(tx, {
          productId: ctx.productIds[0],
          source: fifo_layer_source.PURCHASE,
          layerDate: new Date('2026-08-01T00:00:00Z'),
          unitCost: D('7000.0000'),
          qty: D('5.00'),
          warehouseId: ctx.mainWarehouse,
          documentId,
        }),
      );

      const layers = await stock.availableLayers(
        ctx.productIds[0],
        ctx.mainWarehouse,
      );
      // Insertion order was newest-first; FIFO order is by layer_date.
      expect(layers.map((l) => l.layer_id)).toEqual([older.id, newer.id]);
    });
  });

  describe('no code path changes a layer cost (§18.1.6.3–4)', () => {
    it('exposes no endpoint that writes unit_cost', async () => {
      const layerId = await layerWith({ qty: '5.00', unitCost: '7500.0000' });

      for (const path of [
        `/api/stock/layers/${layerId}`,
        `/api/fifo-layers/${layerId}`,
      ]) {
        const response = await asOwner(http().patch(path)).send({
          unit_cost: '1.0000',
        });
        expect(response.status).toBe(404);
      }

      const layer = await prisma.fifo_layers.findUnique({ where: { id: layerId } });
      expect(layer!.unit_cost.toFixed(4)).toBe('7500.0000');
    });
  });
});
