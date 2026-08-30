import { Global, Module } from '@nestjs/common';
import {
  CargoLedgerRepository,
  SupplierLedgerRepository,
} from './ledgers.repository';
import { CargoLedgerService, SupplierLedgerService } from './ledgers.service';

/**
 * Global: the supplier ledger is written by Purchase (payable) and by
 * Supplier Payment, and read by reports and the §39 digest.
 */
@Global()
@Module({
  providers: [
    SupplierLedgerRepository,
    CargoLedgerRepository,
    SupplierLedgerService,
    CargoLedgerService,
  ],
  exports: [SupplierLedgerService, CargoLedgerService],
})
export class LedgersModule {}
