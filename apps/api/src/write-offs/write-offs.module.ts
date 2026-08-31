import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import {
  OtherIncomeController,
  WriteOffsController,
} from './write-offs.controller';
import { WriteOffsService } from './write-offs.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    DocumentsModule,
    StockModule,
    WarehousesModule,
    AccountsModule,
  ],
  controllers: [WriteOffsController, OtherIncomeController],
  providers: [WriteOffsService],
  exports: [WriteOffsService],
})
export class WriteOffsModule {}
