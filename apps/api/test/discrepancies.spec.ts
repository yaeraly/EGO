import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { settleShortage } from '../src/discrepancies/discrepancies.service';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module3Context, confirmedPurchase, resetModule3 } from './module3-harness';

const D = (v: string) => new Prisma.Decimal(v);

describe('Discrepancies and their financial consequence (Module 3.8, §8)', () => {
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
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);
  const flow = () => documentFlow(app, ctx.ownerToken);

  /**
   * The §8.1 scenario: 100 ordered at 1 000 CNY, 90 arrive.
   *
   * `payCny` is settled against the order before the receipt, which is what
   * decides whether the shortage becomes a receivable (§8.2) or reduces the
   * payable (§8.3).
   */
  async function shortDelivery(params: {
    payCny?: string;
    orderedQty?: string;
    receivedQty?: string;
    priceCny?: string;
  }): Promise<{ purchaseId: string; receiptId: string }> {
    const purchaseId = await confirmedPurchase(app, ctx, {
      buyCny: { amount: '200000.00', rate: '1.00' },
      lines: [
        {
          productIndex: 0,
          qty: params.orderedQty ?? '100.00',
          priceCny: params.priceCny ?? '1000.00',
        },
      ],
    });

    if (params.payCny) {
      await flow().createAndConfirm('/api/supplier-payments', {
        supplier_id: ctx.supplierId,
        from_account: ctx.cnyAccount,
        amount_cny: params.payCny,
        purchase_id: purchaseId,
      });
    }

    const { body: receipt } = await asOwner(http().post('/api/receipts'))
      .send({ purchase_id: purchaseId })
      .expect(201);

    await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
      .send({ rate_cny: '1.000000' })
      .expect(201);

    await asOwner(http().post(`/api/receipts/${receipt.id}/lines`))
      .send({
        lines: [
          {
            product_id: ctx.productIds[0],
            received_qty: params.receivedQty ?? '90.00',
          },
        ],
      })
      .expect(201);

    await flow().confirm(receipt.id).expect(201);
    return { purchaseId, receiptId: receipt.id as string };
  }

  const ledgerEntries = () =>
    prisma.supplier_ledger.findMany({
      where: { supplier_id: ctx.supplierId },
      orderBy: { id: 'asc' },
    });

  const supplierBalance = async (): Promise<string> => {
    const { body } = await asOwner(
      http().get(`/api/suppliers/${ctx.supplierId}/ledger`),
    ).expect(200);
    return body.balance_cny as string;
  };

  describe('settleShortage — the §8.3 split, on its own', () => {
    it('sends the whole shortage to a receivable when fully paid (§8.2)', () => {
      const result = settleShortage({
        shortageCny: D('10000.00'),
        paidCny: D('100000.00'),
        orderTotalCny: D('100000.00'),
      });
      expect(result.receivableCny.toFixed(2)).toBe('10000.00');
      expect(result.payableReductionCny.toFixed(2)).toBe('0.00');
    });

    it('reduces the payable and raises nothing when unpaid (§8.3)', () => {
      const result = settleShortage({
        shortageCny: D('10000.00'),
        paidCny: D('0.00'),
        orderTotalCny: D('100000.00'),
      });
      expect(result.receivableCny.toFixed(2)).toBe('0.00');
      expect(result.payableReductionCny.toFixed(2)).toBe('10000.00');
    });

    it('splits in the proportion actually paid', () => {
      const result = settleShortage({
        shortageCny: D('10000.00'),
        paidCny: D('40000.00'),
        orderTotalCny: D('100000.00'),
      });
      expect(result.receivableCny.toFixed(2)).toBe('4000.00');
      expect(result.payableReductionCny.toFixed(2)).toBe('6000.00');
    });

    it('always adds back up to the shortage, to the tiyin', () => {
      const result = settleShortage({
        shortageCny: D('1000.00'),
        paidCny: D('1.00'),
        orderTotalCny: D('3.00'),
      });
      expect(
        result.receivableCny.plus(result.payableReductionCny).toFixed(2),
      ).toBe('1000.00');
    });

    it('ignores an overpayment — only this order counts', () => {
      const result = settleShortage({
        shortageCny: D('10000.00'),
        paidCny: D('500000.00'),
        orderTotalCny: D('100000.00'),
      });
      expect(result.receivableCny.toFixed(2)).toBe('10000.00');
    });
  });

  describe('§8.2 — paid for, never arrived', () => {
    it('raises a Supplier Receivable for the missing 10 000 CNY', async () => {
      await shortDelivery({ payCny: '100000.00' });

      const entries = await ledgerEntries();
      const receivable = entries.find((e) => e.entry_type === 'RECEIVABLE');
      expect(receivable).toBeDefined();
      expect(receivable!.amount_cny.toFixed(2)).toBe('10000.00');
      // The debt was in yuan, so the claim is too (§8.2).
      expect(receivable!.kgs_value!.toFixed(2)).toBe('10000.00');

      // Ordered 100 000, paid 100 000, 10 000 now owed back to us.
      expect(await supplierBalance()).toBe('10000.00');
    });

    it('does not raise the landed cost of what did arrive (§8.1, §8.2)', async () => {
      const { receiptId } = await shortDelivery({ payCny: '100000.00' });

      const lot = await prisma.lots.findFirst({
        where: { receipt_id: receiptId },
        include: { lot_items: true },
      });
      // 90 000 ÷ 90 = 1 000 — unchanged by the receivable.
      expect(lot!.lot_items[0].unit_landed_cost.toFixed(4)).toBe('1000.0000');
      expect(lot!.total_landed_cost_kgs!.toFixed(2)).toBe('90000.00');
    });
  });

  describe('§8.3 — not yet paid for, never arrived', () => {
    it('reduces the payable and creates no receivable', async () => {
      await shortDelivery({});

      const entries = await ledgerEntries();
      expect(entries.some((e) => e.entry_type === 'RECEIVABLE')).toBe(false);

      // 100 000 owed, less the 10 000 that never came.
      expect(await supplierBalance()).toBe('-90000.00');
    });

    it('splits a part-paid order between the two (§8.3)', async () => {
      await shortDelivery({ payCny: '40000.00' });

      const entries = await ledgerEntries();
      const receivable = entries.find((e) => e.entry_type === 'RECEIVABLE');
      expect(receivable!.amount_cny.toFixed(2)).toBe('4000.00');

      // −100 000 payable, +40 000 paid, +6 000 payable reduction,
      // +4 000 receivable.
      expect(await supplierBalance()).toBe('-50000.00');
    });
  });

  describe('§8.4 — the cause is established later', () => {
    it('starts UNKNOWN and is reclassified with an audit entry', async () => {
      const { receiptId } = await shortDelivery({});
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);
      expect(difs[0].dtype).toBe('UNKNOWN');

      await asOwner(http().patch(`/api/discrepancies/${difs[0].document_id}`))
        .send({
          dtype: 'CARGO_LOSS',
          reason: 'Карго 10 кутуну жоготконун мойнуна алды',
        })
        .expect(200);

      const updated = await prisma.discrepancies.findUnique({
        where: { document_id: difs[0].document_id },
      });
      expect(updated!.dtype).toBe('CARGO_LOSS');

      const audit = await prisma.audit_log.findFirst({
        where: {
          action: 'DISCREPANCY_UPDATED',
          document_id: difs[0].document_id,
        },
      });
      expect(audit).not.toBeNull();
      expect(audit!.reason).toMatch(/Карго/);
    });

    it('is the OWNER\'s call, not a salesperson\'s', async () => {
      const { receiptId } = await shortDelivery({});
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);

      await asStaff(http().patch(`/api/discrepancies/${difs[0].document_id}`))
        .send({ dtype: 'CARGO_LOSS' })
        .expect(403);
    });

    it('needs a stated decision to write one off (§8.5)', async () => {
      const { receiptId } = await shortDelivery({});
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);

      await asOwner(http().patch(`/api/discrepancies/${difs[0].document_id}`))
        .send({ dstatus: 'WRITTEN_OFF' })
        .expect(400);

      await asOwner(http().patch(`/api/discrepancies/${difs[0].document_id}`))
        .send({
          dstatus: 'WRITTEN_OFF',
          financial_decision: 'Карго жооп бербеди; жоготуу катары эсептен чыгарылды',
        })
        .expect(200);
    });
  });

  describe('§8.9 — a discrepancy is never deleted', () => {
    it('exposes no delete endpoint and no create endpoint', async () => {
      const { receiptId } = await shortDelivery({});
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);

      await asOwner(
        http().delete(`/api/discrepancies/${difs[0].document_id}`),
      ).expect(404);
      await asOwner(http().post('/api/discrepancies')).send({}).expect(404);
    });

    it('refuses to change a closed one', async () => {
      const { receiptId } = await shortDelivery({});
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);

      await asOwner(http().patch(`/api/discrepancies/${difs[0].document_id}`))
        .send({ dstatus: 'CLOSED', financial_decision: 'Жабылды' })
        .expect(200);
      await asOwner(http().patch(`/api/discrepancies/${difs[0].document_id}`))
        .send({ dtype: 'CARGO_LOSS' })
        .expect(409);
    });
  });

  describe('§8.8 — excess is not free goods', () => {
    it('raises an open EXCESS act and values nothing', async () => {
      const { receiptId } = await shortDelivery({
        orderedQty: '100.00',
        receivedQty: '105.00',
      });

      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);
      expect(difs).toHaveLength(1);
      expect(difs[0].dtype).toBe('EXCESS');
      expect(difs[0].dstatus).toBe('OPEN');
      expect(difs[0].diff_qty).toBe('5');
      expect(difs[0].documents.doc_number).toMatch(/^DIF-/);
    });

    it('leaves the supplier ledger untouched by the extra units', async () => {
      await shortDelivery({ orderedQty: '100.00', receivedQty: '105.00' });

      // The order was for 100 000 CNY; five unordered units change nothing
      // until the OWNER records a decision (§8.8).
      expect(await supplierBalance()).toBe('-100000.00');
      const entries = await ledgerEntries();
      expect(entries.map((e) => e.entry_type)).toEqual(['PAYABLE']);
    });
  });

  describe('the acts themselves', () => {
    it('carry the ordered, received and difference quantities (§8)', async () => {
      const { receiptId, purchaseId } = await shortDelivery({});
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);

      expect(difs[0]).toMatchObject({
        receipt_id: receiptId,
        purchase_id: purchaseId,
        product_id: ctx.productIds[0],
        ordered_qty: '100',
        received_qty: '90',
        diff_qty: '-10',
      });
      expect(difs[0].products.sku).toBe('MOT-1800');
    });

    it('record the settlement arithmetic in the audit log', async () => {
      const { receiptId } = await shortDelivery({ payCny: '40000.00' });
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);

      const audit = await prisma.audit_log.findFirst({
        where: {
          action: 'DISCREPANCY_SETTLED',
          document_id: difs[0].document_id,
        },
      });
      expect(audit!.new_value).toMatchObject({
        shortage_cny: '10000.00',
        paid_cny: '40000.00',
        receivable_cny: '4000.00',
        payable_reduction_cny: '6000.00',
      });
    });

    it('raise nothing when the delivery matches the order', async () => {
      const { receiptId } = await shortDelivery({ receivedQty: '100.00' });
      const { body: difs } = await asOwner(
        http().get(`/api/discrepancies?receipt_id=${receiptId}`),
      ).expect(200);
      expect(difs).toEqual([]);
    });
  });
});
