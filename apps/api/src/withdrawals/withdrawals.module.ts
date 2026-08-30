import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CapitalModule } from '../capital/capital.module';
import { DocumentsModule } from '../documents/documents.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [DocumentsModule, AccountsModule, CapitalModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
