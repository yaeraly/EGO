import { Module } from '@nestjs/common';
import { ImageStorageService } from './image-storage.service';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesService } from './product-images.service';

/** Files that belong to a record: for now, product photos (§12-Б.1). */
@Module({
  controllers: [ProductImagesController],
  providers: [ImageStorageService, ProductImagesService],
  exports: [ImageStorageService, ProductImagesService],
})
export class MediaModule {}
