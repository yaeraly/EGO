import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { confirmedPurchase } from './module3-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';

describe('Product catalogue (Module 5, §12-Б, §36-А.1)', () => {
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

  async function category(
    name: string,
    defaultWarrantyDays?: number,
  ): Promise<string> {
    const { body } = await asOwner(http().post('/api/categories'))
      .send({
        name,
        ...(defaultWarrantyDays === undefined
          ? {}
          : { default_warranty_days: defaultWarrantyDays }),
      })
      .expect(201);
    return body.id as string;
  }

  describe('Categories (§12-Б.1)', () => {
    it('creates one and reports how many products are filed under it', async () => {
      const id = await category('Моторлор', 30);

      const { body } = await asStaff(http().get('/api/categories')).expect(200);
      expect(body).toEqual([
        expect.objectContaining({
          id,
          name: 'Моторлор',
          default_warranty_days: 30,
          product_count: 0,
        }),
      ]);

      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { category_id: id },
      });

      const { body: after } = await asStaff(http().get('/api/categories')).expect(200);
      expect(after[0].product_count).toBe(1);
    });

    it('defaults the warranty to zero — §36-А.1 makes 0 a real answer', async () => {
      const id = await category('Майда тетиктер');
      const { body } = await asStaff(http().get(`/api/categories/${id}`)).expect(200);
      expect(body.default_warranty_days).toBe(0);
    });

    it('refuses a duplicate name', async () => {
      await category('Контроллерлер', 14);
      await asOwner(http().post('/api/categories'))
        .send({ name: 'Контроллерлер' })
        .expect(409);
    });

    it('is written by the OWNER only (§2)', async () => {
      await asStaff(http().post('/api/categories'))
        .send({ name: 'Аккумуляторлор' })
        .expect(403);
    });

    it('refuses a negative warranty', async () => {
      await asOwner(http().post('/api/categories'))
        .send({ name: 'Тормоз', default_warranty_days: -1 })
        .expect(400);
    });

    it('will not delete a category that still has products (§12-Б.7)', async () => {
      const id = await category('Дөңгөлөктөр', 7);
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { category_id: id },
      });

      const { body } = await asOwner(http().delete(`/api/categories/${id}`)).expect(409);
      expect(body.message).toContain('1 товар');

      // Emptied, it goes.
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { category_id: null },
      });
      await asOwner(http().delete(`/api/categories/${id}`)).expect(204);
      await asStaff(http().get(`/api/categories/${id}`)).expect(404);
    });

    it('records every change in the audit log (§27)', async () => {
      const id = await category('Рамалар', 0);
      await asOwner(http().patch(`/api/categories/${id}`))
        .send({ default_warranty_days: 90 })
        .expect(200);

      const entries = await prisma.audit_log.findMany({
        where: { entity: 'product_categories', entity_id: id },
        orderBy: { id: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual([
        'CATEGORY_CREATED',
        'CATEGORY_UPDATED',
      ]);
      expect(entries[1].old_value).toMatchObject({ default_warranty_days: 0 });
      expect(entries[1].new_value).toMatchObject({ default_warranty_days: 90 });
    });
  });

  describe('Alternative names (§12-Б.2, §12-Б.9.6)', () => {
    it('finds the product by an alias nobody put in its name', async () => {
      const product = ctx.productIds[0];
      await asOwner(http().post(`/api/products/${product}/aliases`))
        .send({ alias: 'двигатель', kind: 'RU' })
        .expect(201);

      const { body } = await asStaff(http().get('/api/products?q=двигат')).expect(200);
      expect(body.map((p: { id: string }) => p.id)).toContain(product);
    });

    it('refuses the same alias twice on one product', async () => {
      const product = ctx.productIds[0];
      await asOwner(http().post(`/api/products/${product}/aliases`))
        .send({ alias: 'мотор 1000W' })
        .expect(201);
      await asOwner(http().post(`/api/products/${product}/aliases`))
        .send({ alias: 'МОТОР 1000W' })
        .expect(409);
    });

    it('rejects a kind the schema does not name', async () => {
      await asOwner(http().post(`/api/products/${ctx.productIds[0]}/aliases`))
        .send({ alias: 'x', kind: 'CHINESE' })
        .expect(400);
    });

    it('removes one, and refuses an alias belonging to another product', async () => {
      const { body: alias } = await asOwner(
        http().post(`/api/products/${ctx.productIds[0]}/aliases`),
      )
        .send({ alias: 'контроллер', kind: 'KG' })
        .expect(201);

      await asOwner(
        http().delete(`/api/products/${ctx.productIds[1]}/aliases/${alias.id}`),
      ).expect(404);

      await asOwner(
        http().delete(`/api/products/${ctx.productIds[0]}/aliases/${alias.id}`),
      ).expect(204);

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/aliases`),
      ).expect(200);
      expect(body).toEqual([]);
    });

    it('is written by the OWNER only (§2)', async () => {
      await asStaff(http().post(`/api/products/${ctx.productIds[0]}/aliases`))
        .send({ alias: 'x' })
        .expect(403);
    });
  });

  describe('Warranty on the card (§12-Б.7, §36-А.1)', () => {
    it("takes the category's default when the product sets none", async () => {
      const id = await category('Моторлор', 30);
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { category_id: id, warranty_days: null },
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.warranty).toEqual({ days: 30, source: 'CATEGORY' });
    });

    it("prefers the product's own term, and treats 0 as a real answer", async () => {
      const id = await category('Моторлор', 30);
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { category_id: id, warranty_days: 0 },
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.warranty).toEqual({ days: 0, source: 'PRODUCT' });
    });

    it('is none at all without a product term or a category', async () => {
      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.warranty).toEqual({ days: 0, source: 'NONE' });
    });
  });

  describe('Stock block on the card (§12-Б.4)', () => {
    it('counts DEFECT stock as held but not as available (§12-А.6)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '10.00', unitCost: '100.0000' });
      await stockLayer(app, prisma, ctx, {
        qty: '4.00',
        unitCost: '100.0000',
        warehouseId: ctx.defectWarehouse,
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);

      expect(body.stock.current_qty).toBe('14.00');
      expect(body.stock.available_qty).toBe('10.00');
      expect(body.stock.total_value_kgs).toBe('1400.00');
      expect(body.layers).toHaveLength(2);
    });

    it('warns below the minimum on available stock, not on everything held', async () => {
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { min_stock: '5.00' },
      });
      await stockLayer(app, prisma, ctx, {
        qty: '8.00',
        unitCost: '100.0000',
        warehouseId: ctx.defectWarehouse,
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.stock.current_qty).toBe('8.00');
      expect(body.stock.available_qty).toBe('0.00');
      expect(body.stock.below_minimum).toBe(true);
    });

    it('is empty rather than absent for a product nobody has stocked', async () => {
      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.stock).toMatchObject({
        current_qty: '0.00',
        available_qty: '0.00',
        inbound_qty: '0.00',
        by_warehouse: [],
      });
      expect(body.pricing.current_fifo_cost).toBeNull();
    });
  });

  describe('Purchase history and cost (§12-Б.5, §12-Б.6)', () => {
    it('ignores a draft order — a draft is not a price anyone agreed to', async () => {
      await asOwner(http().post('/api/purchases'))
        .send({
          supplier_id: ctx.supplierId,
          items: [
            { product_id: ctx.productIds[0], qty: '12.00', price_cny: '250.00' },
          ],
        })
        .expect(201);

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.purchasing.last_purchase).toBeNull();
      expect(body.stock.inbound_qty).toBe('0.00');
    });

    it('reads the last confirmed order rather than storing a price', async () => {
      const purchaseId = await confirmedPurchase(app, ctx, {
        lines: [{ productIndex: 0, qty: '12.00', priceCny: '250.00' }],
        buyCny: { amount: '5000.00', rate: '12.50' },
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.purchasing.last_purchase).toMatchObject({
        document_id: purchaseId,
        price_cny: '250.00',
        qty: '12.00',
      });
      // Ordered and confirmed, nothing received yet (§12-Б.4).
      expect(body.stock.inbound_qty).toBe('12.00');
      expect(body.purchasing.last_receipt_date).toBeNull();
    });

    it('prices from the oldest layer, and shows the base markup on it (§13.3)', async () => {
      await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '200.0000',
        date: '2026-08-01',
      });
      await stockLayer(app, prisma, ctx, {
        qty: '5.00',
        unitCost: '300.0000',
        date: '2026-08-20',
      });
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { base_markup_pct: '35.00' },
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/card`),
      ).expect(200);
      expect(body.pricing.current_fifo_cost).toBe('200.0000');
      expect(body.pricing.indicative_price).toBe('270.00');
    });
  });

  describe('Product fields §12-Б adds', () => {
    it('stores the stock thresholds, warranty and notes', async () => {
      const categoryId = await category('Моторлор', 30);
      const { body } = await asOwner(http().post('/api/products'))
        .send({
          sku: 'MTR-1000',
          name: 'Мотор 1000W 60V',
          category_id: categoryId,
          weight_kg: '12.500',
          min_stock: '2.00',
          reorder_point: '4.00',
          warranty_days: 45,
          description: '60V 1000W арткы мотор',
          compatibility_notes: 'EGO-3 жана EGO-5 моделдерине туура келет',
        })
        .expect(201);

      expect(body).toMatchObject({
        min_stock: '2',
        reorder_point: '4',
        warranty_days: 45,
      });

      const { body: card } = await asStaff(
        http().get(`/api/products/${body.id}/card`),
      ).expect(200);
      expect(card.stock.min_stock).toBe('2.00');
      expect(card.stock.reorder_point).toBe('4.00');
      expect(card.warranty).toEqual({ days: 45, source: 'PRODUCT' });
      expect(card.product.compatibility_notes).toContain('EGO-3');
    });

    it('leaves the thresholds alone when an update does not mention them', async () => {
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { min_stock: '3.00', reorder_point: '6.00' },
      });

      await asOwner(http().patch(`/api/products/${ctx.productIds[0]}`))
        .send({ brand: 'Bosch' })
        .expect(200);

      const after = await prisma.products.findUniqueOrThrow({
        where: { id: ctx.productIds[0] },
      });
      expect(after.min_stock.toFixed(2)).toBe('3.00');
      expect(after.reorder_point.toFixed(2)).toBe('6.00');
      expect(after.brand).toBe('Bosch');
    });
  });
});
