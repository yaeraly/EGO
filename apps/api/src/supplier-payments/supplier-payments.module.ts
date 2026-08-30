import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { DocumentsModule } from '../documents/documents.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SupplierPaymentsRepository } from './supplier-payments.repository';
import { SupplierPaymentsService } from './supplier-payments.service';

@Module({
  imports: [
    DocumentsModule,
    AccountsModule,
    CounterpartiesModule,
    PurchasesModule,
  ],
  controllers: [SupplierPaymentsController],
  providers: [SupplierPaymentsService, SupplierPaymentsRepository],
  exports: [SupplierPaymentsService, SupplierPaymentsRepository],
})
export class SupplierPaymentsModule {}
