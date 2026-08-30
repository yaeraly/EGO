import { Module } from '@nestjs/common';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { DocumentsModule } from '../documents/documents.module';
import { ProductsModule } from '../products/products.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesRepository } from './purchases.repository';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [DocumentsModule, CounterpartiesModule, ProductsModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, PurchasesRepository],
  exports: [PurchasesService, PurchasesRepository],
})
export class PurchasesModule {}
