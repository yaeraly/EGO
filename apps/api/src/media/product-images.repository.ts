import { Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';
import { EncodedImage } from './image-encoder';

/** A picture as everything except the route that serves the bytes sees it. */
export interface ProductImageMeta {
  id: string;
  width: number;
  height: number;
  bytes: number;
  uploaded_at: string;
  uploaded_by: string;
}

/**
 * The pictures table (§12-Б.1).
 *
 * `data` is never selected except by the one method that serves it: a
 * product's photos are megabytes, and a list that carried them would drag
 * them through every card that only wants to know how many there are.
 */
@Injectable()
export class ProductImagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listMeta(
    productId: string,
    db: Db = this.prisma,
  ): Promise<ProductImageMeta[]> {
    const rows = await db.product_images.findMany({
      where: { product_id: productId },
      orderBy: [{ sort_order: 'asc' }, { uploaded_at: 'asc' }],
      select: {
        id: true,
        width: true,
        height: true,
        byte_size: true,
        uploaded_at: true,
        uploaded_by: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      width: row.width,
      height: row.height,
      bytes: row.byte_size,
      uploaded_at: row.uploaded_at.toISOString(),
      uploaded_by: row.uploaded_by,
    }));
  }

  count(productId: string, db: Db = this.prisma): Promise<number> {
    return db.product_images.count({ where: { product_id: productId } });
  }

  async insert(
    params: {
      productId: string;
      image: EncodedImage;
      sortOrder: number;
      uploadedBy: string;
    },
    db: Db = this.prisma,
  ): Promise<string> {
    const row = await db.product_images.create({
      data: {
        product_id: params.productId,
        sort_order: params.sortOrder,
        content_type: params.image.contentType,
        width: params.image.width,
        height: params.image.height,
        byte_size: params.image.data.length,
        // Prisma's Bytes is a plain Uint8Array; a Node Buffer is one, but
        // its typing allows a SharedArrayBuffer that Prisma's does not.
        data: new Uint8Array(params.image.data),
        uploaded_by: params.uploadedBy,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** The bytes themselves — the only place they are read. */
  async findBytes(
    productId: string,
    imageId: string,
  ): Promise<{ data: Buffer; content_type: string } | null> {
    const row = await this.prisma.product_images.findFirst({
      where: { id: imageId, product_id: productId },
      select: { data: true, content_type: true },
    });
    return row
      ? { data: Buffer.from(row.data), content_type: row.content_type }
      : null;
  }

  exists(
    productId: string,
    imageId: string,
    db: Db = this.prisma,
  ): Promise<{ id: string } | null> {
    return db.product_images.findFirst({
      where: { id: imageId, product_id: productId },
      select: { id: true },
    });
  }

  async delete(
    productId: string,
    imageId: string,
    db: Db = this.prisma,
  ): Promise<void> {
    await db.product_images.deleteMany({
      where: { id: imageId, product_id: productId },
    });
  }

  /** Writes the order the ids are given in. */
  async setOrder(
    productId: string,
    ids: string[],
    db: Db = this.prisma,
  ): Promise<void> {
    for (const [index, id] of ids.entries()) {
      await db.product_images.updateMany({
        where: { id, product_id: productId },
        data: { sort_order: index },
      });
    }
  }
}
