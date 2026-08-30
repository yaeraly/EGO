import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { DocumentsModule } from '../documents/documents.module';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransfersService } from './transfers.service';

@Module({
  imports: [DocumentsModule, AccountsModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransfersRepository],
  exports: [TransfersService],
})
export class TransfersModule {}
