import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { encodeProductImage } from './image-encoder';
import {
  ProductImageMeta,
  ProductImagesRepository,
} from './product-images.repository';

/** §12-Б.1 asks the card to carry the part's picture; this is how many. */
const MAX_IMAGES = 8;

/**
 * The pictures on a product card (§12-Б.1).
 *
 * Both the list and the bytes live in the database, so a `pg_dump` carries
 * the photos with everything else and neither half can be restored without
 * the other.
 *
 * The first image is the one shown wherever a single picture is wanted, so
 * reordering is how a person chooses the main photo — there is no separate
 * flag to fall out of step with the order.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ProductImagesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(productId: string): Promise<ProductImageMeta[]> {
    await this.requireProduct(productId);
    return this.images.listMeta(productId);
  }

  async add(
    productId: string,
    file: { buffer: Buffer; size: number } | undefined,
    userId: string,
  ): Promise<ProductImageMeta[]> {
    await this.requireProduct(productId);
    // Encoding is the slow part and needs no transaction; it also refuses a
    // file that is not a picture before a row is ever considered.
    const encoded = await encodeProductImage(file);

    const { imageId, list } = await this.prisma.$transaction(async (tx) => {
      const existing = await this.images.count(productId, tx);
      if (existing >= MAX_IMAGES) {
        throw new BadRequestException(
          `Бир товарга ${MAX_IMAGES} сүрөттөн көп тиркелбейт`,
        );
      }

      const id = await this.images.insert(
        {
          productId,
          image: encoded,
          sortOrder: existing,
          uploadedBy: userId,
        },
        tx,
      );

      return { imageId: id, list: await this.images.listMeta(productId, tx) };
    });

    await this.audit.log({
      userId,
      entity: 'product_images',
      entityId: imageId,
      action: 'PRODUCT_IMAGE_ADDED',
      newValue: { product_id: productId, bytes: encoded.data.length },
    });

    return list;
  }

  async remove(
    productId: string,
    imageId: string,
    userId: string,
  ): Promise<ProductImageMeta[]> {
    await this.requireProduct(productId);

    const list = await this.prisma.$transaction(async (tx) => {
      if (!(await this.images.exists(productId, imageId, tx))) {
        throw new NotFoundException('Сүрөт табылган жок');
      }
      await this.images.delete(productId, imageId, tx);
      // The gap the removed picture leaves is closed, so the first one is
      // still the main one and the order stays 0..n-1.
      const left = await this.images.listMeta(productId, tx);
      await this.images.setOrder(
        productId,
        left.map((image) => image.id),
        tx,
      );
      return left;
    });

    await this.audit.log({
      userId,
      entity: 'product_images',
      entityId: imageId,
      action: 'PRODUCT_IMAGE_REMOVED',
      oldValue: { product_id: productId },
    });

    return list;
  }

  /** Puts one image first — which is how the main photo is chosen. */
  async makeFirst(
    productId: string,
    imageId: string,
    userId: string,
  ): Promise<ProductImageMeta[]> {
    await this.requireProduct(productId);

    const list = await this.prisma.$transaction(async (tx) => {
      const current = await this.images.listMeta(productId, tx);
      const chosen = current.find((image) => image.id === imageId);
      if (!chosen) {
        throw new NotFoundException('Сүрөт табылган жок');
      }

      const next = [chosen, ...current.filter((image) => image.id !== imageId)];
      await this.images.setOrder(
        productId,
        next.map((image) => image.id),
        tx,
      );
      return next;
    });

    await this.audit.log({
      userId,
      entity: 'product_images',
      entityId: imageId,
      action: 'PRODUCT_IMAGE_REORDERED',
      newValue: { product_id: productId, main_image: true },
    });

    return list;
  }

  /** The bytes, for the route that serves them. */
  async read(
    productId: string,
    imageId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const row = await this.images.findBytes(productId, imageId);
    if (!row) {
      throw new NotFoundException('Сүрөт табылган жок');
    }
    return { data: row.data, contentType: row.content_type };
  }

  private async requireProduct(id: string): Promise<void> {
    const product = await this.prisma.products.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Товар табылган жок');
    }
  }
}
