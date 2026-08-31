import { Module, forwardRef } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BonusesModule } from '../bonuses/bonuses.module';
import { CreditModule } from '../credit/credit.module';
import { CustomersModule } from '../customers/customers.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { AdvancesController } from './advances.controller';
import { AdvancesRepository } from './advances.repository';
import { AdvancesService } from './advances.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    BonusesModule,
    DocumentsModule,
    CustomersModule,
    AccountsModule,
    CreditModule,
    forwardRef(() => SalesModule),
  ],
  controllers: [AdvancesController],
  providers: [AdvancesService, AdvancesRepository],
  exports: [AdvancesService],
})
export class AdvancesModule {}
