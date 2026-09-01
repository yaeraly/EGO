import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module4Context, resetModule4 } from './module4-harness';

describe('Structured compatibility (Module 21, §12-Б.8)', () => {
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

  async function model(name: string, brand?: string): Promise<string> {
    const { body } = await asOwner(http().post('/api/vehicle-models'))
      .send({ name, ...(brand ? { brand } : {}) })
      .expect(201);
    return body.id as string;
  }

  const link = (productId: string, modelId: string, note?: string) =>
    asStaff(http().post(`/api/products/${productId}/compatibility`)).send({
      model_id: modelId,
      ...(note ? { note } : {}),
    });

  describe('The model list (§12-Б.8)', () => {
    it('is the OWNER’s to keep, and everyone’s to read', async () => {
      await asStaff(http().post('/api/vehicle-models'))
        .send({ name: 'Zongshen 1000W' })
        .expect(403);

      await model('Zongshen 1000W', 'Zongshen');

      const { body } = await asStaff(http().get('/api/vehicle-models')).expect(200);
      expect(body).toEqual([
        expect.objectContaining({
          brand: 'Zongshen',
          name: 'Zongshen 1000W',
          products: 0,
          verified: 0,
        }),
      ]);
    });

    it('takes a model with no brand, and refuses a second of the same name', async () => {
      await model('Кытай трициклы');
      await asOwner(http().post('/api/vehicle-models'))
        .send({ name: 'Кытай трициклы' })
        .expect(409);
      // The same name under a brand is a different model.
      await model('Кытай трициклы', 'Zongshen');
    });

    it('archives rather than deletes, and hides the archived by default', async () => {
      const id = await model('Эски модель');
      await asOwner(http().patch(`/api/vehicle-models/${id}`))
        .send({ is_active: false })
        .expect(200);

      expect((await asOwner(http().get('/api/vehicle-models')).expect(200)).body).toEqual(
        [],
      );
      const { body } = await asOwner(http().get('/api/vehicle-models'))
        .query({ include_inactive: true })
        .expect(200);
      expect(body).toHaveLength(1);
    });
  });

  describe('Saying a part fits (§12-Б.8)', () => {
    it('is anyone’s to record, and starts unverified', async () => {
      const modelId = await model('Zongshen 1000W');

      const { body } = await link(
        ctx.productIds[0],
        modelId,
        'Кардар өзү текшерди',
      ).expect(201);

      expect(body).toMatchObject({
        model_id: modelId,
        model_name: 'Zongshen 1000W',
        status: 'UNVERIFIED',
        note: 'Кардар өзү текшерди',
        verified_by: null,
        verified_at: null,
      });
    });

    it('records the same pair once', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);
      await link(ctx.productIds[0], modelId).expect(409);
    });

    it('refuses an archived model, and an unknown one', async () => {
      const modelId = await model('Эски модель');
      await asOwner(http().patch(`/api/vehicle-models/${modelId}`))
        .send({ is_active: false })
        .expect(200);

      await link(ctx.productIds[0], modelId).expect(400);
      await link(ctx.productIds[0], ctx.customerId).expect(404);
    });

    it('lists every model a part is recorded against', async () => {
      const first = await model('Zongshen 1000W');
      const second = await model('Lifan 800W');
      await link(ctx.productIds[0], first).expect(201);
      await link(ctx.productIds[0], second).expect(201);

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}/compatibility`),
      ).expect(200);
      expect(body).toHaveLength(2);
      expect(body.map((row: { model_name: string }) => row.model_name)).toEqual([
        'Lifan 800W',
        'Zongshen 1000W',
      ]);
    });

    it('can be taken back, and the removal is on the record (§27)', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);

      await asStaff(
        http().delete(`/api/products/${ctx.productIds[0]}/compatibility/${modelId}`),
      ).expect(200);

      expect(
        (
          await asStaff(
            http().get(`/api/products/${ctx.productIds[0]}/compatibility`),
          ).expect(200)
        ).body,
      ).toEqual([]);

      const entry = await prisma.audit_log.findFirst({
        where: { action: 'COMPATIBILITY_UNLINKED' },
      });
      expect(entry).not.toBeNull();
    });
  });

  describe('Checking that it fits (§12-Б.8)', () => {
    it('is the OWNER’s word, and keeps who gave it and when', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);

      await asStaff(
        http().post(
          `/api/products/${ctx.productIds[0]}/compatibility/${modelId}/verify`,
        ),
      ).expect(400);

      const { body } = await asOwner(
        http().post(
          `/api/products/${ctx.productIds[0]}/compatibility/${modelId}/verify`,
        ),
      ).expect(201);

      expect(body.status).toBe('VERIFIED');
      expect(body.verified_by).toBe(ctx.ownerId);
      expect(body.verified_by_name).toBe('Owner');
      expect(body.verified_at).not.toBeNull();
    });

    it('can be taken back, and forgets who had checked it', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);
      await asOwner(
        http().post(
          `/api/products/${ctx.productIds[0]}/compatibility/${modelId}/verify`,
        ),
      ).expect(201);

      const { body } = await asOwner(
        http().delete(
          `/api/products/${ctx.productIds[0]}/compatibility/${modelId}/verify`,
        ),
      ).expect(200);

      expect(body.status).toBe('UNVERIFIED');
      expect(body.verified_by).toBeNull();
      expect(body.verified_at).toBeNull();
    });

    it('counts what is recorded and what is checked, per model', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);
      await link(ctx.productIds[1], modelId).expect(201);
      await asOwner(
        http().post(
          `/api/products/${ctx.productIds[0]}/compatibility/${modelId}/verify`,
        ),
      ).expect(201);

      const { body } = await asOwner(http().get('/api/vehicle-models')).expect(200);
      expect(body[0]).toMatchObject({ products: 2, verified: 1 });
    });
  });

  describe('Finding the parts for a model (§12-Б.8)', () => {
    it('narrows the catalogue to one model', async () => {
      const zongshen = await model('Zongshen 1000W');
      const lifan = await model('Lifan 800W');
      await link(ctx.productIds[0], zongshen).expect(201);
      await link(ctx.productIds[1], lifan).expect(201);

      const { body } = await asStaff(http().get('/api/products'))
        .query({ model_id: zongshen })
        .expect(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(ctx.productIds[0]);
    });

    it('can be narrowed again to what somebody has checked', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);
      await link(ctx.productIds[1], modelId).expect(201);
      await asOwner(
        http().post(
          `/api/products/${ctx.productIds[1]}/compatibility/${modelId}/verify`,
        ),
      ).expect(201);

      const all = await asStaff(http().get('/api/products'))
        .query({ model_id: modelId })
        .expect(200);
      expect(all.body).toHaveLength(2);

      const checked = await asStaff(http().get('/api/products'))
        .query({ model_id: modelId, verified_only: true })
        .expect(200);
      expect(checked.body).toHaveLength(1);
      expect(checked.body[0].id).toBe(ctx.productIds[1]);
    });

    it('still finds a part by the words people type (§12-Б.9.6)', async () => {
      const modelId = await model('Zongshen 1000W');
      await link(ctx.productIds[0], modelId).expect(201);
      const product = await prisma.products.findUniqueOrThrow({
        where: { id: ctx.productIds[0] },
      });

      // The structured link does not replace the free-text search.
      const { body } = await asStaff(http().get('/api/products'))
        .query({ q: product.sku })
        .expect(200);
      expect(body[0].id).toBe(ctx.productIds[0]);
    });

    it('leaves the MVP’s own notes field exactly where it was (§12-Б.8)', async () => {
      await prisma.products.update({
        where: { id: ctx.productIds[0] },
        data: { compatibility_notes: 'Кызыл трициклдерге туура келет' },
      });

      const { body } = await asStaff(
        http().get(`/api/products/${ctx.productIds[0]}`),
      ).expect(200);
      expect(body.compatibility_notes).toBe('Кызыл трициклдерге туура келет');
    });
  });
});
