import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import { CategoryJobService } from './category-job.service';

@Module({
  imports: [PrismaModule, AuditModule, SettingsModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository, CategoryJobService],
  exports: [CustomersService, CustomersRepository, CategoryJobService],
})
export class CustomersModule {}
