import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CurrencyModule } from '../currency/currency.module';
import { DiscrepanciesModule } from '../discrepancies/discrepancies.module';
import { DocumentsModule } from '../documents/documents.module';
import { LedgersModule } from '../ledgers/ledgers.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { ReceiptConfirmService } from './receipt-confirm.service';
import { ReceiptRatesService } from './receipt-rates.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsRepository } from './receipts.repository';
import { ReceiptsService } from './receipts.service';

@Module({
  imports: [
    PrismaModule,
    DocumentsModule,
    PurchasesModule,
    CurrencyModule,
    SettingsModule,
    LedgersModule,
    StockModule,
    WarehousesModule,
    DiscrepanciesModule,
    AuditModule,
  ],
  controllers: [ReceiptsController],
  providers: [
    ReceiptsService,
    ReceiptsRepository,
    ReceiptRatesService,
    ReceiptConfirmService,
  ],
  exports: [ReceiptsService, ReceiptsRepository],
})
export class ReceiptsModule {}
