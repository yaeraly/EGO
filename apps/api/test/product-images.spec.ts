import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { createTestApp } from './app-harness';
import { Module2Context, resetModule2 } from './module2-harness';

describe('Product photos (§12-Б.1)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Module2Context;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule2(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  /** A real picture, made here so the test needs no binary fixture. */
  const photo = (width = 60, height = 40, colour = { r: 200, g: 30, b: 30 }) =>
    sharp({
      create: { width, height, channels: 3, background: colour },
    })
      .png()
      .toBuffer();

  const upload = (productId: string, file: Buffer, name = 'part.png') =>
    asOwner(http().post(`/api/products/${productId}/images`)).attach(
      'file',
      file,
      name,
    );

  const product = () => ctx.productIds[0];

  describe('Uploading', () => {
    it('stores the picture, lists it and serves the bytes back', async () => {
      const { body: images } = await upload(product(), await photo()).expect(
        201,
      );

      expect(images).toHaveLength(1);
      expect(images[0]).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        width: 60,
        height: 40,
        bytes: expect.any(Number),
        uploaded_at: expect.any(String),
        uploaded_by: ctx.ownerId,
      });

      const { body: listed } = await asStaff(
        http().get(`/api/products/${product()}/images`),
      ).expect(200);
      expect(listed).toEqual(images);

      const served = await asStaff(
        http().get(`/api/products/${product()}/images/${images[0].id}`),
      ).expect(200);
      expect(served.headers['content-type']).toBe('image/jpeg');
      // Whatever went in, what comes out is the re-encoded JPEG.
      expect(await sharp(served.body).metadata()).toEqual(
        expect.objectContaining({ format: 'jpeg', width: 60, height: 40 }),
      );
    });

    it('keeps the bytes in the database, not on a disk somewhere', async () => {
      const { body: images } = await upload(product(), await photo()).expect(
        201,
      );

      const row = await prisma.product_images.findUniqueOrThrow({
        where: { id: images[0].id },
        select: { data: true, content_type: true, byte_size: true },
      });
      expect(row.content_type).toBe('image/jpeg');
      expect(row.data.length).toBe(row.byte_size);
      expect(row.byte_size).toBe(images[0].bytes);
    });

    it('shrinks a photo bigger than the catalogue needs', async () => {
      const { body: images } = await upload(
        product(),
        await photo(3000, 2000),
      ).expect(201);

      expect(images[0].width).toBe(1400);
      expect(images[0].height).toBe(933);
    });

    it('refuses a file that is not an image', async () => {
      const { body } = await upload(
        product(),
        Buffer.from('this is a text file pretending to be a photo'),
        'part.jpg',
      ).expect(400);
      expect(body.message).toContain('сүрөт эмес');
    });

    it('refuses an upload with no file at all', async () => {
      await asOwner(http().post(`/api/products/${product()}/images`)).expect(
        400,
      );
    });

    it('refuses a file far too big to be a photo', async () => {
      // Sixteen megabytes: past the limit, and refused before anything tries
      // to decode it.
      await upload(product(), Buffer.alloc(16 * 1024 * 1024, 7), 'huge.jpg')
        .expect(413);
    });

    it('is the OWNER’s to do — reference data is not everyone’s to change (§2)', async () => {
      await asStaff(http().post(`/api/products/${product()}/images`))
        .attach('file', await photo(), 'part.png')
        .expect(403);
    });

    it('stops at eight pictures for one product', async () => {
      for (let i = 0; i < 8; i += 1) {
        await upload(product(), await photo(20 + i, 20)).expect(201);
      }
      const { body } = await upload(product(), await photo()).expect(400);
      expect(body.message).toContain('8 сүрөттөн көп');
    });

    it('does not touch a product that does not exist', async () => {
      await upload(
        '00000000-0000-4000-8000-000000000000',
        await photo(),
      ).expect(404);
    });
  });

  describe('Choosing the main photo', () => {
    it('is done by putting one first', async () => {
      await upload(product(), await photo(10, 10)).expect(201);
      const { body: two } = await upload(
        product(),
        await photo(20, 20),
      ).expect(201);
      const second = two[1].id as string;

      const { body: reordered } = await asOwner(
        http().post(`/api/products/${product()}/images/${second}/main`),
      ).expect(200);

      expect(reordered.map((image: { id: string }) => image.id)).toEqual([
        second,
        two[0].id,
      ]);
      // Nothing is lost by reordering.
      expect(reordered).toHaveLength(2);
    });

    it('refuses a picture that belongs to nobody', async () => {
      await asOwner(
        http().post(
          `/api/products/${product()}/images/00000000-0000-4000-8000-000000000000/main`,
        ),
      ).expect(404);
    });
  });

  describe('Removing', () => {
    it('takes the bytes out of the database with the row', async () => {
      const { body: images } = await upload(product(), await photo()).expect(
        201,
      );
      const id = images[0].id as string;
      expect(await prisma.product_images.count()).toBe(1);

      const { body: left } = await asOwner(
        http().delete(`/api/products/${product()}/images/${id}`),
      ).expect(200);

      expect(left).toEqual([]);
      expect(await prisma.product_images.count()).toBe(0);
      await asOwner(
        http().get(`/api/products/${product()}/images/${id}`),
      ).expect(404);
    });

    it('is the OWNER’s to do', async () => {
      const { body: images } = await upload(product(), await photo()).expect(
        201,
      );
      await asStaff(
        http().delete(`/api/products/${product()}/images/${images[0].id}`),
      ).expect(403);
    });
  });

  describe('One product’s pictures are its own', () => {
    it('will not serve another product’s photo through this product', async () => {
      const { body: images } = await upload(product(), await photo()).expect(
        201,
      );
      await asStaff(
        http().get(
          `/api/products/${ctx.productIds[1]}/images/${images[0].id}`,
        ),
      ).expect(404);
    });
  });

  describe('The audit trail', () => {
    it('records who added and who removed a picture', async () => {
      const { body: images } = await upload(product(), await photo()).expect(
        201,
      );
      await asOwner(
        http().delete(`/api/products/${product()}/images/${images[0].id}`),
      ).expect(200);

      const entries = await prisma.audit_log.findMany({
        where: { entity: 'product_images', entity_id: images[0].id },
        orderBy: { created_at: 'asc' },
        select: { action: true, user_id: true },
      });
      expect(entries).toEqual([
        { action: 'PRODUCT_IMAGE_ADDED', user_id: ctx.ownerId },
        { action: 'PRODUCT_IMAGE_REMOVED', user_id: ctx.ownerId },
      ]);
    });
  });
});
