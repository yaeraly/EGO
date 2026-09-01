import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  ProductCompatibilityController,
  VehicleModelsController,
} from './compatibility.controller';
import { CompatibilityService } from './compatibility.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [VehicleModelsController, ProductCompatibilityController],
  providers: [CompatibilityService],
  exports: [CompatibilityService],
})
export class CompatibilityModule {}
