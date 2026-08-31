import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, customer_type } from '@prisma/client';
import request from 'supertest';
import { Module3Context, resetModule3 } from './module3-harness';

export interface Module4Context extends Module3Context {
  walkInId: string;
  customerId: string;
  /** The seller's own KGS till and bank account (§19). */
  sellerCash: string;
  sellerBank: string;
  /** The OWNER's own till — §19 keeps each person's money apart. */
  ownerCash: string;
}

/**
 * Module 3's fixture plus what a sale needs: the Walk-in customer, one
 * registered customer, and the salesperson's own accounts.
 */
export async function resetModule4(
  app: INestApplication,
  prisma: PrismaClient,
): Promise<Module4Context> {
  const ctx = await resetModule3(app, prisma);

  const walkIn = await prisma.customers.create({
    data: {
      is_walk_in: true,
      name: 'Walk-in (катталбаган кардар)',
      ctype: customer_type.RETAIL,
    },
    select: { id: true },
  });

  const customer = await prisma.customers.create({
    data: { name: 'Азамат', phone: '0555111222', ctype: customer_type.RETAIL },
    select: { id: true },
  });

  // §13.1: without a stated ceiling a salesperson may give no discount at
  // all. The fixture gives one so tests about other rules are not stopped by
  // this one; the approval test lowers it deliberately.
  await prisma.users.update({
    where: { id: ctx.staffId },
    data: { max_discount_pct: '20.00' },
  });

  // Security: sales at or above this need a PIN. Seeded in production; the
  // test database is truncated, so the fixture sets the same value.
  await prisma.settings.create({
    data: {
      key: 'sale.pin_required_threshold_kgs',
      value: 50000,
      description: 'Sales at or above this KGS amount require a PIN.',
    },
  });

  const sellerCash = await prisma.payment_accounts.create({
    data: {
      name: 'Seller Cash',
      type: 'CASH',
      currency: 'KGS',
      owner_user: ctx.staffId,
    },
    select: { id: true },
  });
  const sellerBank = await prisma.payment_accounts.create({
    data: {
      name: 'Seller MBank',
      type: 'BANK',
      currency: 'KGS',
      owner_user: ctx.staffId,
    },
    select: { id: true },
  });

  const ownerCash = await prisma.payment_accounts.create({
    data: {
      name: 'Owner Cash',
      type: 'CASH',
      currency: 'KGS',
      owner_user: ctx.ownerId,
    },
    select: { id: true },
  });

  return {
    ...ctx,
    walkInId: walkIn.id,
    customerId: customer.id,
    sellerCash: sellerCash.id,
    sellerBank: sellerBank.id,
    ownerCash: ownerCash.id,
  };
}

/**
 * Puts stock on the shelf at a stated cost, without running a whole receipt.
 *
 * Module 3 proves the receipt produces the right layer; these tests are about
 * what selling does with it, so the layer is created directly.
 */
export async function stockLayer(
  app: INestApplication,
  prisma: PrismaClient,
  ctx: Module4Context,
  params: {
    productIndex?: number;
    qty: string;
    unitCost: string;
    date?: string;
    warehouseId?: string;
  },
): Promise<string> {
  const { body: purchase } = await request(app.getHttpServer())
    .post('/api/purchases')
    .set('Authorization', `Bearer ${ctx.ownerToken}`)
    .send({
      supplier_id: ctx.supplierId,
      items: [{ product_id: ctx.productIds[0], qty: '1.00', price_cny: '1.00' }],
    })
    .expect(201);

  const layer = await prisma.fifo_layers.create({
    data: {
      product_id: ctx.productIds[params.productIndex ?? 0],
      source: 'PURCHASE',
      source_doc_id: purchase.id,
      layer_date: new Date(`${params.date ?? '2026-08-01'}T00:00:00Z`),
      unit_cost: new Prisma.Decimal(params.unitCost),
      initial_qty: new Prisma.Decimal(params.qty),
    },
    select: { id: true },
  });

  await prisma.layer_stock.create({
    data: {
      layer_id: layer.id,
      warehouse_id: params.warehouseId ?? ctx.mainWarehouse,
      qty: new Prisma.Decimal(params.qty),
    },
  });
  await prisma.stock_movements.create({
    data: {
      mtype: 'RECEIPT_IN',
      layer_id: layer.id,
      warehouse_id: params.warehouseId ?? ctx.mainWarehouse,
      qty: new Prisma.Decimal(params.qty),
      unit_cost: new Prisma.Decimal(params.unitCost),
      document_id: purchase.id,
    },
  });

  return layer.id;
}

/** Gives a product a selling price the pricing engine can work from. */
export async function priceProduct(
  prisma: PrismaClient,
  productId: string,
  params: { baseMarkupPct?: string; minSellingPrice?: string | null },
): Promise<void> {
  await prisma.products.update({
    where: { id: productId },
    data: {
      ...(params.baseMarkupPct !== undefined
        ? { base_markup_pct: params.baseMarkupPct }
        : {}),
      ...(params.minSellingPrice !== undefined
        ? { min_selling_price: params.minSellingPrice }
        : {}),
    },
  });
}
