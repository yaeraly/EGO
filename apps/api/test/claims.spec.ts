import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { documentFlow } from './module2-harness';
import { Module3Context, confirmedPurchase, resetModule3 } from './module3-harness';

describe('Claims (Module 3.9, §8.5, §8.7)', () => {
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
   * 100 motors ordered at 1 000 CNY, 90 arrive, freight paid — the shape of
   * every §8.5 example.
   */
  async function shortageWithFreight(params: { paidFreight?: boolean } = {}) {
    const purchaseId = await confirmedPurchase(app, ctx, {
      buyCny: { amount: '200000.00', rate: '1.00' },
      lines: [{ productIndex: 0, qty: '100.00', priceCny: '1000.00' }],
    });

    const { body: receipt } = await asOwner(http().post('/api/receipts'))
      .send({ purchase_id: purchaseId })
      .expect(201);

    await asOwner(http().post(`/api/receipts/${receipt.id}/rates`))
      .send({ rate_cny: '1.000000', rate_usd: '87.000000' })
      .expect(201);

    await asOwner(http().post(`/api/receipts/${receipt.id}/expenses`))
      .send({
        etype: 'INTL_CARGO',
        amount: '8700.00',
        currency: 'KGS',
        is_paid: params.paidFreight ?? true,
      })
      .expect(201);

    await asOwner(http().post(`/api/receipts/${receipt.id}/lines`))
      .send({ lines: [{ product_id: ctx.productIds[0], received_qty: '90.00' }] })
      .expect(201);

    await flow().confirm(receipt.id).expect(201);

    const { body: difs } = await asOwner(
      http().get(`/api/discrepancies?receipt_id=${receipt.id}`),
    ).expect(200);

    return {
      purchaseId,
      receiptId: receipt.id as string,
      discrepancyId: difs[0].document_id as string,
    };
  }

  describe('opening a claim (§8.5)', () => {
    it('values a supplier claim as the price of the missing goods, in CNY', async () => {
      const { discrepancyId } = await shortageWithFreight();

      const { body } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);

      // 10 missing × 1 000 CNY.
      expect(body.amount).toBe('10000');
      expect(body.currency).toBe('CNY');
      expect(body.cstatus).toBe('OPEN');
      expect(body.supplier_id).toBe(ctx.supplierId);
      expect(body.cargo_company_id).toBeNull();
    });

    it('adds the lost goods\' share of paid freight to a cargo claim (§8.5)', async () => {
      const { discrepancyId } = await shortageWithFreight({ paidFreight: true });

      const { body } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'CARGO_CLAIM' })
        .expect(201);

      // Goods: 10 000 CNY at 1.00 → 10 000 KGS ÷ 87 = 114.94 USD.
      // Freight: 8 700 KGS paid, 10 of 100 units lost → 870 KGS ÷ 87 = 10 USD.
      expect(body.currency).toBe('USD');
      expect(body.amount).toBe('124.94');
      expect(body.cargo_company_id).toBe(ctx.cargoCompanyId);

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'CLAIM_OPENED', document_id: body.document_id },
      });
      expect(audit!.new_value).toMatchObject({
        goods_value: '114.94',
        freight_share: '10.00',
      });
    });

    it('counts only freight that was actually paid (§8.5)', async () => {
      const { discrepancyId } = await shortageWithFreight({ paidFreight: false });

      const { body } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'CARGO_CLAIM' })
        .expect(201);

      // Unpaid freight is still owed to the carrier; it is not money we lost.
      expect(body.amount).toBe('114.94');
    });

    it('accepts an amount stated by hand', async () => {
      const { discrepancyId } = await shortageWithFreight();

      const { body } = await asOwner(http().post('/api/claims'))
        .send({
          discrepancy_id: discrepancyId,
          ctype: 'SUPPLIER_CLAIM',
          amount: '9500.00',
        })
        .expect(201);
      expect(body.amount).toBe('9500');
    });

    it('links to its discrepancy and moves it to UNDER_REVIEW (§8.5, §8.9)', async () => {
      const { discrepancyId } = await shortageWithFreight();

      const { body } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);

      expect(body.discrepancy_id).toBe(discrepancyId);
      const dif = await prisma.discrepancies.findUnique({
        where: { document_id: discrepancyId },
      });
      expect(dif!.dstatus).toBe('UNDER_REVIEW');
    });

    it('refuses a second open claim on the same act', async () => {
      const { discrepancyId } = await shortageWithFreight();
      await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);
      await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'CARGO_CLAIM' })
        .expect(409);
    });

    it('is the OWNER\'s business', async () => {
      const { discrepancyId } = await shortageWithFreight();
      await asStaff(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(403);
    });
  });

  describe('compensation (§8.7)', () => {
    async function openClaim(): Promise<string> {
      const { discrepancyId } = await shortageWithFreight();
      const { body } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);
      return body.document_id as string;
    }

    it('marks a partial payment PARTIALLY_COMPENSATED', async () => {
      const claimId = await openClaim();

      const { body } = await asOwner(
        http().post(`/api/claims/${claimId}/compensations`),
      )
        .send({ amount: '4000.00', comment: 'Акча кайтарылды' })
        .expect(201);

      expect(body.cstatus).toBe('PARTIALLY_COMPENSATED');

      const { body: claim } = await asOwner(
        http().get(`/api/claims/${claimId}`),
      ).expect(200);
      expect(claim.compensated_total).toBe('4000.00');
      expect(claim.remaining).toBe('6000.00');
    });

    it('marks it COMPENSATED once it is covered', async () => {
      const claimId = await openClaim();
      await asOwner(http().post(`/api/claims/${claimId}/compensations`))
        .send({ amount: '4000.00' })
        .expect(201);
      const { body } = await asOwner(
        http().post(`/api/claims/${claimId}/compensations`),
      )
        .send({ amount: '6000.00' })
        .expect(201);

      expect(body.cstatus).toBe('COMPENSATED');
    });

    it('links compensation in goods to the batch that carried it (§8.7)', async () => {
      const claimId = await openClaim();

      // The partner sends the missing units with the next order.
      const nextPurchase = await confirmedPurchase(app, ctx, {
        lines: [{ productIndex: 0, qty: '10.00', priceCny: '1000.00' }],
      });
      const { body: nextReceipt } = await asOwner(http().post('/api/receipts'))
        .send({ purchase_id: nextPurchase })
        .expect(201);

      await asOwner(http().post(`/api/claims/${claimId}/compensations`))
        .send({
          amount: '10000.00',
          receipt_id: nextReceipt.id,
          comment: 'Кийинки партияга кошуп берди',
        })
        .expect(201);

      const { body: claim } = await asOwner(
        http().get(`/api/claims/${claimId}`),
      ).expect(200);
      expect(claim.cstatus).toBe('COMPENSATED');
      expect(claim.claim_compensations[0].receipt_id).toBe(nextReceipt.id);
    });

    it('updates the discrepancy alongside the claim (§8.9)', async () => {
      const { discrepancyId } = await shortageWithFreight();
      const { body: claim } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);

      await asOwner(http().post(`/api/claims/${claim.document_id}/compensations`))
        .send({ amount: '4000.00' })
        .expect(201);
      expect(
        (await prisma.discrepancies.findUnique({
          where: { document_id: discrepancyId },
        }))!.dstatus,
      ).toBe('PARTIALLY_COMPENSATED');

      await asOwner(http().post(`/api/claims/${claim.document_id}/compensations`))
        .send({ amount: '6000.00' })
        .expect(201);
      expect(
        (await prisma.discrepancies.findUnique({
          where: { document_id: discrepancyId },
        }))!.dstatus,
      ).toBe('COMPENSATED');
    });

    it('refuses more compensation than the claim is worth', async () => {
      const claimId = await openClaim();
      await asOwner(http().post(`/api/claims/${claimId}/compensations`))
        .send({ amount: '12000.00' })
        .expect(409);
    });

    it('takes no more once it is fully compensated', async () => {
      const claimId = await openClaim();
      await asOwner(http().post(`/api/claims/${claimId}/compensations`))
        .send({ amount: '10000.00' })
        .expect(201);
      await asOwner(http().post(`/api/claims/${claimId}/compensations`))
        .send({ amount: '1.00' })
        .expect(409);
    });
  });

  describe('write-off (§8.5)', () => {
    async function openClaim(): Promise<string> {
      const { discrepancyId } = await shortageWithFreight();
      const { body } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);
      return body.document_id as string;
    }

    it('needs a reason', async () => {
      const claimId = await openClaim();
      await asOwner(http().patch(`/api/claims/${claimId}/status`))
        .send({ cstatus: 'WRITTEN_OFF' })
        .expect(400);
    });

    it('records the loss line and its exclusion from the bonus base', async () => {
      const claimId = await openClaim();

      await asOwner(http().patch(`/api/claims/${claimId}/status`))
        .send({
          cstatus: 'WRITTEN_OFF',
          writeoff_reason: 'Поставщик жооп бербеди, 6 ай өттү',
        })
        .expect(200);

      const audit = await prisma.audit_log.findFirst({
        where: { action: 'CLAIM_WRITTEN_OFF', document_id: claimId },
      });
      expect(audit!.new_value).toMatchObject({
        expense_line: 'LOGISTICS_AND_SUPPLIER_LOSSES',
        excluded_from_bonus_base: true,
        amount: '10000.00',
      });
      expect(audit!.reason).toMatch(/жооп бербеди/);
    });

    it('is refused to anyone but the OWNER', async () => {
      const claimId = await openClaim();
      await asStaff(http().patch(`/api/claims/${claimId}/status`))
        .send({ cstatus: 'WRITTEN_OFF', writeoff_reason: 'жок' })
        .expect(403);
    });

    it('closes the discrepancy with it (§8.9)', async () => {
      const { discrepancyId } = await shortageWithFreight();
      const { body: claim } = await asOwner(http().post('/api/claims'))
        .send({ discrepancy_id: discrepancyId, ctype: 'SUPPLIER_CLAIM' })
        .expect(201);

      await asOwner(http().patch(`/api/claims/${claim.document_id}/status`))
        .send({ cstatus: 'WRITTEN_OFF', writeoff_reason: 'Компенсация болбоду' })
        .expect(200);

      expect(
        (await prisma.discrepancies.findUnique({
          where: { document_id: discrepancyId },
        }))!.dstatus,
      ).toBe('WRITTEN_OFF');
    });

    it('cannot be undone', async () => {
      const claimId = await openClaim();
      await asOwner(http().patch(`/api/claims/${claimId}/status`))
        .send({ cstatus: 'WRITTEN_OFF', writeoff_reason: 'Жоготуу' })
        .expect(200);
      await asOwner(http().patch(`/api/claims/${claimId}/status`))
        .send({ cstatus: 'OPEN' })
        .expect(409);
    });

    it('refuses a compensation status set by hand — it follows the record', async () => {
      const claimId = await openClaim();
      await asOwner(http().patch(`/api/claims/${claimId}/status`))
        .send({ cstatus: 'COMPENSATED' })
        .expect(400);
    });
  });
});
