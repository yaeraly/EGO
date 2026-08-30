import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { DocumentsModule } from '../documents/documents.module';
import { CapitalController } from './capital.controller';
import { CapitalService } from './capital.service';
import { InvestorsService } from './investors.service';

@Module({
  imports: [DocumentsModule, AccountsModule],
  controllers: [CapitalController],
  providers: [CapitalService, InvestorsService],
  exports: [CapitalService, InvestorsService],
})
export class CapitalModule {}
