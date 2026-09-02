import { Module } from '@nestjs/common';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { CurrencyModule } from '../currency/currency.module';
import { DocumentsModule } from '../documents/documents.module';
import { ProductsModule } from '../products/products.module';
import { PurchasePayableService } from './purchase-payable.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesRepository } from './purchases.repository';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [DocumentsModule, CounterpartiesModule, ProductsModule, CurrencyModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, PurchasesRepository, PurchasePayableService],
  exports: [PurchasesService, PurchasesRepository, PurchasePayableService],
})
export class PurchasesModule {}
