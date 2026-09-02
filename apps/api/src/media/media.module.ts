import { Module } from '@nestjs/common';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesRepository } from './product-images.repository';
import { ProductImagesService } from './product-images.service';

/** Files that belong to a record: for now, product photos (§12-Б.1). */
@Module({
  controllers: [ProductImagesController],
  providers: [ProductImagesService, ProductImagesRepository],
  exports: [ProductImagesService],
})
export class MediaModule {}
