import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { DocumentsModule } from '../documents/documents.module';
import { CargoPaymentsController } from './cargo-payments.controller';
import { CargoPaymentsRepository } from './cargo-payments.repository';
import { CargoPaymentsService } from './cargo-payments.service';

@Module({
  imports: [DocumentsModule, AccountsModule, CounterpartiesModule],
  controllers: [CargoPaymentsController],
  providers: [CargoPaymentsService, CargoPaymentsRepository],
  exports: [CargoPaymentsService],
})
export class CargoPaymentsModule {}
