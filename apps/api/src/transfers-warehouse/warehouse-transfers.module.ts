import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { WarehouseTransfersController } from './warehouse-transfers.controller';
import { WarehouseTransfersRepository } from './warehouse-transfers.repository';
import { WarehouseTransfersService } from './warehouse-transfers.service';

@Module({
  imports: [PrismaModule, DocumentsModule, StockModule, WarehousesModule, AuditModule],
  controllers: [WarehouseTransfersController],
  providers: [WarehouseTransfersService, WarehouseTransfersRepository],
  exports: [WarehouseTransfersService],
})
export class WarehouseTransfersModule {}
