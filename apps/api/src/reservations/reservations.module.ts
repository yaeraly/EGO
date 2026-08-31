import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CreditModule } from '../credit/credit.module';
import { CustomersModule } from '../customers/customers.module';
import { DocumentsModule } from '../documents/documents.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { ReservationExpiryService } from './reservation-expiry.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsRepository } from './reservations.repository';
import { ReservationsViewService } from './reservations-view.service';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    DocumentsModule,
    CustomersModule,
    ProductsModule,
    PricingModule,
    StockModule,
    WarehousesModule,
    CreditModule,
    SettingsModule,
  ],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    ReservationsRepository,
    ReservationsViewService,
    ReservationExpiryService,
  ],
  exports: [ReservationsService],
})
export class ReservationsModule {}
