import { Module } from '@nestjs/common';
import { enableBigIntJson } from './common/bigint-json';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { BusinessDaysModule } from './business-days/business-days.module';
import { CapitalModule } from './capital/capital.module';
import { CargoPaymentsModule } from './cargo-payments/cargo-payments.module';
import { CounterpartiesModule } from './counterparties/counterparties.module';
import { LedgersModule } from './ledgers/ledgers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ClaimsModule } from './claims/claims.module';
import { CreditModule } from './credit/credit.module';
import { CustomerPaymentsModule } from './customer-payments/customer-payments.module';
import { CustomersModule } from './customers/customers.module';
import { PricingModule } from './pricing/pricing.module';
import { SalesModule } from './sales/sales.module';
import { DiscrepanciesModule } from './discrepancies/discrepancies.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { StockModule } from './stock/stock.module';
import { WarehouseTransfersModule } from './transfers-warehouse/warehouse-transfers.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { CurrencyModule } from './currency/currency.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health/health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { PurchaseViewModule } from './purchase-view/purchase-view.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SupplierPaymentsModule } from './supplier-payments/supplier-payments.module';
import { SecurityLogModule } from './security/security-log.module';
import { SettingsModule } from './settings/settings.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';

// Applied where the application is assembled, so every entry point — the
// server and the tests alike — gets it.
enableBigIntJson();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SecurityLogModule,
    AuditModule,
    IdempotencyModule,
    BusinessDaysModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    AccountsModule,
    TransfersModule,
    CurrencyModule,
    CapitalModule,
    WithdrawalsModule,
    LedgersModule,
    CounterpartiesModule,
    ProductsModule,
    PurchasesModule,
    SupplierPaymentsModule,
    PurchaseViewModule,
    CargoPaymentsModule,
    NotificationsModule,
    WarehousesModule,
    StockModule,
    WarehouseTransfersModule,
    ReceiptsModule,
    DiscrepanciesModule,
    ClaimsModule,
    CustomersModule,
    CreditModule,
    PricingModule,
    SalesModule,
    CustomerPaymentsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authentication is the default: a route opts out with @Public(),
    // never the other way round.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
