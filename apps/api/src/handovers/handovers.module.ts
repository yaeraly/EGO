import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { UsersModule } from '../users/users.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { HandoversController } from './handovers.controller';
import { HandoversRepository } from './handovers.repository';
import { HandoversService } from './handovers.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    DocumentsModule,
    WarehousesModule,
    StockModule,
    UsersModule,
    SettingsModule,
  ],
  controllers: [HandoversController],
  providers: [HandoversService, HandoversRepository],
  exports: [HandoversService],
})
export class HandoversModule {}
