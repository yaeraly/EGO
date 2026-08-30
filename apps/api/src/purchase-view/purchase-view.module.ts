import { Module } from '@nestjs/common';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { DocumentsModule } from '../documents/documents.module';
import { ProductsModule } from '../products/products.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { PurchaseViewController } from './purchase-view.controller';
import { PurchaseViewService } from './purchase-view.service';

/**
 * A read model, deliberately separate.
 *
 * The purchase card joins an order to its payments, and its payment status
 * (§4.2) is defined by payments against it. Putting that in either module
 * would make the two depend on each other; a reader that depends on both
 * keeps each writer pointing one way.
 */
@Module({
  imports: [
    PurchasesModule,
    SupplierPaymentsModule,
    CounterpartiesModule,
    ProductsModule,
    DocumentsModule,
  ],
  controllers: [PurchaseViewController],
  providers: [PurchaseViewService],
  exports: [PurchaseViewService],
})
export class PurchaseViewModule {}
