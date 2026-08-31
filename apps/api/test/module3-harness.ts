import { INestApplication } from '@nestjs/common';
import { PrismaClient, warehouse_type } from '@prisma/client';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { Module2Context, buyCurrency, documentFlow, resetModule2 } from './module2-harness';

export interface Module3Context extends Module2Context {
  mainWarehouse: string;
  defectWarehouse: string;
  serviceWarehouse: string;
}

/**
 * Module 2's fixture plus the warehouses §12-А requires.
 *
 * MAIN and DEFECT are what the system cannot work without; SERVICE is here so
 * a transfer has somewhere ordinary to go that is neither of those.
 */
export async function resetModule3(
  app: INestApplication,
  prisma: PrismaClient,
): Promise<Module3Context> {
  const ctx = await resetModule2(app, prisma);

  const http = () => request(app.getHttpServer());
  const create = async (
    code: string,
    name: string,
    wtype: warehouse_type,
  ): Promise<string> => {
    const { body } = await http()
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ code, name, wtype })
      .expect(201);
    return body.id as string;
  };

  return {
    ...ctx,
    mainWarehouse: await create('MAIN', 'Негизги склад', warehouse_type.MAIN),
    defectWarehouse: await create('DEFECT', 'Брак склады', warehouse_type.DEFECT),
    serviceWarehouse: await create('SERVICE', 'Сервис', warehouse_type.SERVICE),
  };
}

/**
 * A confirmed purchase, ready to receive.
 *
 * Buying yuan first is not optional: confirming a purchase recognises the
 * payable at a reference rate (§10.1), and there is no rate until the
 * business has bought that currency once.
 */
export async function confirmedPurchase(
  app: INestApplication,
  ctx: Module3Context,
  params: {
    lines: { productIndex: number; qty: string; priceCny: string }[];
    /** How many yuan to buy, and at what rate, before ordering. */
    buyCny?: { amount: string; rate: string };
  },
): Promise<string> {
  if (params.buyCny) {
    await buyCurrency(app, ctx, {
      kgs: new Prisma.Decimal(params.buyCny.amount)
        .times(params.buyCny.rate)
        .toFixed(2),
      foreign: params.buyCny.amount,
      toAccount: ctx.cnyAccount,
    });
  }

  const { id } = await documentFlow(app, ctx.ownerToken).createAndConfirm(
    '/api/purchases',
    {
      supplier_id: ctx.supplierId,
      cargo_company_id: ctx.cargoCompanyId,
      items: params.lines.map((line) => ({
        product_id: ctx.productIds[line.productIndex],
        qty: line.qty,
        price_cny: line.priceCny,
      })),
    },
  );
  return id;
}

/** Sets the weight §9.1 demands, and optionally the volume §9.4 wants. */
export async function setProductMeasurements(
  prisma: PrismaClient,
  productId: string,
  measurements: { weightKg?: string | null; chargeableWeightKg?: string | null },
): Promise<void> {
  await prisma.products.update({
    where: { id: productId },
    data: {
      ...(measurements.weightKg !== undefined
        ? { weight_kg: measurements.weightKg }
        : {}),
      ...(measurements.chargeableWeightKg !== undefined
        ? { chargeable_weight_kg: measurements.chargeableWeightKg }
        : {}),
    },
  });
}
