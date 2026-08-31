import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BonusesModule } from '../bonuses/bonuses.module';
import { CategoriesModule } from '../categories/categories.module';
import { CreditModule } from '../credit/credit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { ReturnsController } from './returns.controller';
import { ReturnsRepository } from './returns.repository';
import { ReturnsViewService } from './returns-view.service';
import { ReturnConfirmContext, ReturnsService } from './returns.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    BonusesModule,
    DocumentsModule,
    SalesModule,
    CreditModule,
    StockModule,
    WarehousesModule,
    AccountsModule,
    CategoriesModule,
  ],
  controllers: [ReturnsController],
  providers: [
    ReturnsService,
    ReturnsRepository,
    ReturnsViewService,
    ReturnConfirmContext,
  ],
  exports: [ReturnsService],
})
export class ReturnsModule {}
