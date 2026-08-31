import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoriesController } from './inventories.controller';
import { InventoriesRepository } from './inventories.repository';
import { InventoriesViewService } from './inventories-view.service';
import {
  InventoriesService,
  InventoryConfirmContext,
} from './inventories.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    DocumentsModule,
    WarehousesModule,
    ProductsModule,
    StockModule,
  ],
  controllers: [InventoriesController],
  providers: [
    InventoriesService,
    InventoriesRepository,
    InventoriesViewService,
    InventoryConfirmContext,
  ],
  exports: [InventoriesService],
})
export class InventoriesModule {}
