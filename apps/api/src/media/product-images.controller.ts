import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { user_role } from '@prisma/client';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MAX_UPLOAD_BYTES } from './image-encoder';
import { ProductImageMeta } from './product-images.repository';
import { ProductImagesService } from './product-images.service';

/**
 * The pictures on a product card (§12-Б.1).
 *
 * Reference data is written by the OWNER and read by everyone (§2), and a
 * product's photo is part of that card, so the same rule applies here.
 */
@Controller('products/:productId/images')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Get()
  list(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductImageMeta[]> {
    return this.images.list(productId);
  }

  /**
   * The bytes.
   *
   * Behind the same JWT as the rest of the API, so the web client fetches it
   * and shows the result rather than pointing an <img> at the URL.
   */
  @Get(':imageId')
  async serve(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.images.read(productId, imageId);
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', image.data.length);
    // The id is a UUID that never points at different bytes, so a browser
    // may keep it as long as it likes.
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    response.end(image.data);
  }

  @Roles(user_role.OWNER)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  add(
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductImageMeta[]> {
    return this.images.add(productId, file, user.id);
  }

  /** Putting an image first is how the main photo is chosen. */
  @Roles(user_role.OWNER)
  @Post(':imageId/main')
  @HttpCode(200)
  makeFirst(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductImageMeta[]> {
    return this.images.makeFirst(productId, imageId, user.id);
  }

  @Roles(user_role.OWNER)
  @Delete(':imageId')
  remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductImageMeta[]> {
    return this.images.remove(productId, imageId, user.id);
  }
}
