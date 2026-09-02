import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, products } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImageStorageService, StoredImage } from './image-storage.service';

/** §12-Б.1 asks the card to carry the part's picture; this is how many. */
const MAX_IMAGES = 8;

/**
 * The pictures on a product card (§12-Б.1).
 *
 * The list lives on the product row and the bytes live on disk. The first
 * image is the one shown wherever a single picture is wanted, so reordering
 * is how a person chooses the main photo — there is no separate flag to fall
 * out of step with the list.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ImageStorageService,
    private readonly audit: AuditService,
  ) {}

  async list(productId: string): Promise<StoredImage[]> {
    const product = await this.require(productId);
    return this.imagesOf(product);
  }

  async add(
    productId: string,
    file: { buffer: Buffer; size: number; mimetype?: string } | undefined,
    userId: string,
  ): Promise<StoredImage[]> {
    const product = await this.require(productId);
    const images = this.imagesOf(product);
    if (images.length >= MAX_IMAGES) {
      throw new BadRequestException(
        `Бир товарга ${MAX_IMAGES} сүрөттөн көп тиркелбейт`,
      );
    }

    const stored = await this.storage.store(file, userId);
    const next = [...images, stored];
    await this.save(productId, next);

    await this.audit.log({
      userId,
      entity: 'products',
      entityId: productId,
      action: 'PRODUCT_IMAGE_ADDED',
      newValue: { image_id: stored.id, bytes: stored.bytes },
    });

    return next;
  }

  async remove(
    productId: string,
    imageId: string,
    userId: string,
  ): Promise<StoredImage[]> {
    const product = await this.require(productId);
    const images = this.imagesOf(product);
    if (!images.some((image) => image.id === imageId)) {
      throw new NotFoundException('Сүрөт табылган жок');
    }

    const next = images.filter((image) => image.id !== imageId);
    await this.save(productId, next);
    // The row is what the card reads, so it goes first: a file left behind is
    // wasted space, a row pointing at a missing file is a broken card.
    await this.storage.remove(imageId);

    await this.audit.log({
      userId,
      entity: 'products',
      entityId: productId,
      action: 'PRODUCT_IMAGE_REMOVED',
      oldValue: { image_id: imageId },
    });

    return next;
  }

  /** Puts one image first — which is how the main photo is chosen. */
  async makeFirst(
    productId: string,
    imageId: string,
    userId: string,
  ): Promise<StoredImage[]> {
    const product = await this.require(productId);
    const images = this.imagesOf(product);
    const chosen = images.find((image) => image.id === imageId);
    if (!chosen) {
      throw new NotFoundException('Сүрөт табылган жок');
    }

    const next = [chosen, ...images.filter((image) => image.id !== imageId)];
    await this.save(productId, next);

    await this.audit.log({
      userId,
      entity: 'products',
      entityId: productId,
      action: 'PRODUCT_IMAGE_REORDERED',
      newValue: { main_image: imageId },
    });

    return next;
  }

  /** The bytes, for the route that serves them. */
  async read(productId: string, imageId: string): Promise<Buffer> {
    const images = await this.list(productId);
    if (!images.some((image) => image.id === imageId)) {
      throw new NotFoundException('Сүрөт табылган жок');
    }
    return this.storage.read(imageId);
  }

  private async require(id: string): Promise<products> {
    const product = await this.prisma.products.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Товар табылган жок');
    }
    return product;
  }

  /**
   * The list as it is stored.
   *
   * Anything that is not the shape this service writes is ignored rather
   * than trusted — the column is JSON, and a card should not break because
   * something once wrote a different shape into it.
   */
  private imagesOf(product: products): StoredImage[] {
    const raw = product.images;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(
      (entry): entry is StoredImage & Prisma.JsonObject =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        typeof (entry as Prisma.JsonObject).id === 'string',
    );
  }

  private async save(productId: string, images: StoredImage[]): Promise<void> {
    await this.prisma.products.update({
      where: { id: productId },
      data: {
        images: images as unknown as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });
  }
}
