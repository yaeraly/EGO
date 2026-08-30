import { Module } from '@nestjs/common';
import { DocumentPostingRegistry } from './document-posting.registry';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsRepository, DocumentPostingRegistry],
  exports: [DocumentsService, DocumentsRepository, DocumentPostingRegistry],
})
export class DocumentsModule {}
