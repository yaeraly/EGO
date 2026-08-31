import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';

@Module({
  imports: [PrismaModule, AuditModule, DocumentsModule, ProductsModule],
  controllers: [DefectsController],
  providers: [DefectsService],
  exports: [DefectsService],
})
export class DefectsModule {}
