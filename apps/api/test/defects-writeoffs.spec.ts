import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module4Context, resetModule4, stockLayer } from './module4-harness';

describe('Defect act and write-off (Module 9, §36-А.3, §37, §38)', () => {
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
    await prisma.products.update({
      where: { id: ctx.productIds[0] },
      data: { base_markup_pct: '50.00' },
    });
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  /** A defective unit sitting in DEFECT, arrived there by a return (§35.3). */
  async function defectiveUnit(unitCost = '100.0000'): Promise<{
    returnId: string;
    layerId: string;
  }> {
    await stockLayer(app, prisma, ctx, { qty: '2.00', unitCost });

    const { body: sale } = await asStaff(http().post('/api/sales'))
      .send({
        customer_id: ctx.customerId,
        items: [{ product_id: ctx.productIds[0], qty: '1.00' }],
        payments: [
          {
            account_id: ctx.sellerCash,
            amount: new Prisma.Decimal(unitCost).times(1.5).toFixed(2),
          },
        ],
      })
      .expect(201);
    await asStaff(http().post(`/api/sales/${sale.id}/confirm`))
      .send({ pin: '87654321' })
      .expect(201);

    const item = await prisma.sale_items.findFirstOrThrow({
      where: { sale_id: sale.id },
    });

    const { body: document } = await asStaff(http().post('/api/returns'))
      .send({
        original_sale: sale.id,
        reason: 'Иштебей калды',
        items: [{ sale_item_id: item.id, qty: '1.00', condition: 'DEFECT' }],
      })
      .expect(201);

    await asOwner(http().post(`/api/returns/${document.id}/confirm`))
      .send({
        pin: '12345678',
        refunds: [
          {
            account_id: ctx.sellerCash,
            amount: new Prisma.Decimal(unitCost).times(1.5).toFixed(2),
          },
        ],
        warranty_exception_reason: 'Тест: кепилдиги жок товар',
      })
      .expect(201);

    const layer = await prisma.fifo_layers.findFirstOrThrow({
      where: { source: 'RETURN' },
    });
    return { returnId: document.id, layerId: layer.id };
  }

  describe('Defect act (§37)', () => {
    it('records the origin, the finding and who inspected it', async () => {
      const { returnId } = await defectiveUnit();

      const { body: document } = await asStaff(http().post('/api/defects'))
        .send({
          product_id: ctx.productIds[0],
          qty: '1.00',
          return_id: returnId,
          reason: 'Обмотка күйүп кеткен — заводдук брак',
          decision: 'CLAIM',
        })
        .expect(201);

      const { body } = await asStaff(
        http().get(`/api/defects/${document.id}`),
      ).expect(200);
      expect(body).toMatchObject({
        return_id: returnId,
        decision: 'CLAIM',
        checked_by: ctx.staffId,
      });
    });

    it('refuses an act that traces to neither a return nor a receipt', async () => {
      await asStaff(http().post('/api/defects'))
        .send({
          product_id: ctx.productIds[0],
          qty: '1.00',
          reason: 'Кайдан келгени белгисиз',
        })
        .expect(400);
    });

    it('refuses a decision the schema does not name', async () => {
      const { returnId } = await defectiveUnit();
      await asStaff(http().post('/api/defects'))
        .send({
          product_id: ctx.productIds[0],
          qty: '1.00',
          return_id: returnId,
          reason: 'Тест',
          decision: 'MAYBE',
        })
        .expect(400);
    });

    it('will not confirm an act with no decision (§37)', async () => {
      const { returnId } = await defectiveUnit();
      const { body: document } = await asStaff(http().post('/api/defects'))
        .send({
          product_id: ctx.productIds[0],
          qty: '1.00',
          return_id: returnId,
          reason: 'Текшерилүүдө',
        })
        .expect(201);

      await asStaff(http().post(`/api/documents/${document.id}/confirm`)).expect(
        409,
      );

      await asStaff(http().patch(`/api/defects/${document.id}/decision`))
        .send({ decision: 'WRITEOFF', reason: 'Оңдолбойт' })
        .expect(200);
      await asStaff(http().post(`/api/documents/${document.id}/confirm`)).expect(
        201,
      );

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'DEFECT_ACT_CONFIRMED' },
      });
      expect(entry.new_value).toMatchObject({ decision: 'WRITEOFF' });
    });
  });

  describe('Write-off (§38)', () => {
    it('takes the goods out of DEFECT at their own landed cost', async () => {
      const { layerId } = await defectiveUnit('7000.0000');

      const { body: document } = await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.defectWarehouse,
          reason: 'Оңдолбойт — металлга бөлүнөт',
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(201);

      const { body } = await asOwner(
        http().post(`/api/write-offs/${document.id}/confirm`),
      )
        .send({ pin: '12345678' })
        .expect(201);
      expect(body.total_cost).toBe('7000');

      const stock = await prisma.layer_stock.findUniqueOrThrow({
        where: {
          layer_id_warehouse_id: {
            layer_id: layerId,
            warehouse_id: ctx.defectWarehouse,
          },
        },
      });
      expect(stock.qty.toFixed(2)).toBe('0.00');

      const movement = await prisma.stock_movements.findFirstOrThrow({
        where: { mtype: 'WRITEOFF_OUT' },
      });
      expect(movement.qty.toFixed(2)).toBe('-1.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'WRITE_OFF_CONFIRMED' },
      });
      expect(entry.new_value).toMatchObject({
        total_cost_kgs: '7000.00',
        in_bonus_base: false,
      });
    });

    it('always takes a PIN', async () => {
      const { layerId } = await defectiveUnit();
      const { body: document } = await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.defectWarehouse,
          reason: 'Списание',
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(201);

      const { body } = await asOwner(
        http().post(`/api/write-offs/${document.id}/confirm`),
      )
        .send({ pin: '00000000' })
        .expect(422);
      expect(body.code).toBe('PIN_INVALID');
    });

    it('writes off from DEFECT only (§38.4)', async () => {
      await stockLayer(app, prisma, ctx, { qty: '5.00', unitCost: '100.0000' });
      const layer = await prisma.fifo_layers.findFirstOrThrow({
        where: { source: 'PURCHASE' },
      });

      await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.mainWarehouse,
          reason: 'Жаңылыш',
          items: [{ layer_id: layer.id, qty: '1.00' }],
        })
        .expect(400);
    });

    it('refuses more than the defect warehouse holds (§42.5)', async () => {
      const { layerId } = await defectiveUnit();
      await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.defectWarehouse,
          reason: 'Ашыкча',
          items: [{ layer_id: layerId, qty: '5.00' }],
        })
        .expect(409);
    });

    it('waits for an open supplier claim to be settled first (§38.2)', async () => {
      const { layerId } = await defectiveUnit();

      // A claim raised over the same product, still open.
      const discrepancyDocument = await prisma.documents.create({
        data: {
          doc_type: 'DIF',
          doc_number: 'DIF-2026-900001',
          business_date: new Date(),
          status: 'CONFIRMED',
          created_by: ctx.ownerId,
        },
      });
      const purchase = await prisma.purchases.findFirstOrThrow();
      // A discrepancy hangs off a receipt; the fixture's stock came in
      // without one, so the minimum the foreign keys need is created here.
      const receiptDocument = await prisma.documents.create({
        data: {
          doc_type: 'RCV',
          doc_number: 'RCV-2026-900001',
          business_date: new Date(),
          status: 'CONFIRMED',
          created_by: ctx.ownerId,
        },
      });
      await prisma.receipts.create({
        data: {
          document_id: receiptDocument.id,
          purchase_id: purchase.document_id,
          rstatus: 'CLOSED',
        },
      });

      await prisma.discrepancies.create({
        data: {
          document_id: discrepancyDocument.id,
          receipt_id: receiptDocument.id,
          purchase_id: purchase.document_id,
          product_id: ctx.productIds[0],
          ordered_qty: '1.00',
          received_qty: '0.00',
          diff_qty: '-1.00',
          dtype: 'SUPPLIER_SHORTAGE',
        },
      });
      const claimDocument = await prisma.documents.create({
        data: {
          doc_type: 'CLM',
          doc_number: 'CLM-2026-900001',
          business_date: new Date(),
          status: 'CONFIRMED',
          created_by: ctx.ownerId,
        },
      });
      await prisma.claims.create({
        data: {
          document_id: claimDocument.id,
          ctype: 'SUPPLIER_CLAIM',
          discrepancy_id: discrepancyDocument.id,
          supplier_id: ctx.supplierId,
          amount: '1000.00',
          currency: 'CNY',
          cstatus: 'OPEN',
        },
      });

      const { body } = await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.defectWarehouse,
          reason: 'Списание',
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(422);
      expect(body.code).toBe('OPEN_CLAIM');
      expect(body.claims[0].doc_number).toBe('CLM-2026-900001');

      // Settled, the write-off goes ahead.
      await prisma.claims.update({
        where: { document_id: claimDocument.id },
        data: { cstatus: 'WRITTEN_OFF', writeoff_reason: 'Поставщик жооп бербеди' },
      });
      await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.defectWarehouse,
          reason: 'Списание',
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(201);
    });
  });

  describe('Scrap income and the net loss (§38.7)', () => {
    it('books the metal money and reports what the defect cost net', async () => {
      const { layerId } = await defectiveUnit('7000.0000');

      const { body: writeOff } = await asOwner(http().post('/api/write-offs'))
        .send({
          warehouse_id: ctx.defectWarehouse,
          reason: 'Металлга бөлүнөт',
          items: [{ layer_id: layerId, qty: '1.00' }],
        })
        .expect(201);
      await asOwner(http().post(`/api/write-offs/${writeOff.id}/confirm`))
        .send({ pin: '12345678' })
        .expect(201);

      const before = await asOwner(
        http().get(`/api/write-offs/${writeOff.id}/result`),
      ).expect(200);
      expect(before.body).toEqual({
        written_off_cost: '7000.00',
        scrap_income: '0.00',
        net_loss: '7000.00',
      });

      const { body: income } = await asOwner(http().post('/api/other-income'))
        .send({
          category: 'METAL_SALE',
          account_id: ctx.ownerCash,
          amount: '1200.00',
          linked_write_off: writeOff.id,
          source: 'Жез жана алюминий сатылды',
        })
        .expect(201);
      await asOwner(http().post(`/api/documents/${income.id}/confirm`)).expect(201);

      const { body } = await asOwner(
        http().get(`/api/write-offs/${writeOff.id}/result`),
      ).expect(200);
      expect(body).toEqual({
        written_off_cost: '7000.00',
        scrap_income: '1200.00',
        net_loss: '5800.00',
      });

      // The money is really in the till, and marked out of the bonus base.
      const movement = await prisma.account_movements.findFirstOrThrow({
        where: { document_id: income.id },
      });
      expect(movement.amount.toFixed(2)).toBe('1200.00');

      const entry = await prisma.audit_log.findFirstOrThrow({
        where: { action: 'OTHER_INCOME_RECEIVED' },
      });
      expect(entry.new_value).toMatchObject({
        category: 'METAL_SALE',
        in_bonus_base: false,
      });
    });

    it('refuses to link income to a write-off that does not exist', async () => {
      await asOwner(http().post('/api/other-income'))
        .send({
          category: 'METAL_SALE',
          account_id: ctx.ownerCash,
          amount: '100.00',
          linked_write_off: '00000000-0000-0000-0000-000000000000',
          source: 'Тест',
        })
        .expect(404);
    });
  });
});
