import { Global, Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { DocumentsModule } from '../documents/documents.module';
import { CurrencyExchangeController } from './currency-exchange.controller';
import { CurrencyExchangeService } from './currency-exchange.service';
import { CurrencyFifoService } from './currency-fifo.service';

/**
 * Global so later Priority 1 modules (SPY, CPY) can consume currency layers
 * without importing the exchange machinery.
 */
@Global()
@Module({
  imports: [DocumentsModule, AccountsModule],
  controllers: [CurrencyExchangeController],
  providers: [CurrencyFifoService, CurrencyExchangeService],
  exports: [CurrencyFifoService, CurrencyExchangeService],
})
export class CurrencyModule {}
