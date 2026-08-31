import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { StockModule } from '../stock/stock.module';
import { ProductAliasesRepository } from './product-aliases.repository';
import { ProductCardRepository } from './product-card.repository';
import { ProductCardService } from './product-card.service';
import { ProductsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [CategoriesModule, StockModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsRepository,
    ProductAliasesRepository,
    ProductCardService,
    ProductCardRepository,
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
