import { Module, forwardRef } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AdvancesModule } from '../advances/advances.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CreditModule } from '../credit/credit.module';
import { CustomersModule } from '../customers/customers.module';
import { DocumentsModule } from '../documents/documents.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReservationsModule } from '../reservations/reservations.module';
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
    ReservationsModule,
    StockModule,
    WarehousesModule,
    AccountsModule,
    SettingsModule,
    AuthModule,
    AuditModule,
    // §17-А.2: a confirmed sale spends the customer's advances. Advances in
    // turn settle debts through SalesRepository (§35.4), so the two modules
    // genuinely need each other.
    forwardRef(() => AdvancesModule),
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
