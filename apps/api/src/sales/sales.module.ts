import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CreditModule } from '../credit/credit.module';
import { CustomersModule } from '../customers/customers.module';
import { DocumentsModule } from '../documents/documents.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import {
  SaleConfirmContextHolder,
  SaleConfirmService,
} from './sale-confirm.service';
import { SalesController } from './sales.controller';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [
    PrismaModule,
    DocumentsModule,
    CustomersModule,
    CreditModule,
    PricingModule,
    StockModule,
    WarehousesModule,
    AccountsModule,
    SettingsModule,
    AuthModule,
    AuditModule,
  ],
  controllers: [SalesController],
  providers: [
    SalesService,
    SalesRepository,
    SaleConfirmService,
    SaleConfirmContextHolder,
  ],
  exports: [SalesService, SalesRepository],
})
export class SalesModule {}
