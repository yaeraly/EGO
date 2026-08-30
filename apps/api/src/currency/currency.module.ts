import { Global, Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { DocumentsModule } from '../documents/documents.module';
import { CurrencyExchangeController } from './currency-exchange.controller';
import { CurrencyExchangeRepository } from './currency-exchange.repository';
import { CurrencyExchangeService } from './currency-exchange.service';
import { CurrencyFifoService } from './currency-fifo.service';
import { CurrencyLayersRepository } from './currency-layers.repository';

/**
 * Global so later Priority 1 modules (SPY, CPY) can consume currency layers
 * without importing the exchange machinery.
 */
@Global()
@Module({
  imports: [DocumentsModule, AccountsModule],
  controllers: [CurrencyExchangeController],
  providers: [
    CurrencyLayersRepository,
    CurrencyExchangeRepository,
    CurrencyFifoService,
    CurrencyExchangeService,
  ],
  exports: [CurrencyFifoService, CurrencyExchangeService],
})
export class CurrencyModule {}
