import { Module } from '@nestjs/common';
import { DocumentPostingRegistry } from './document-posting.registry';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentPostingRegistry],
  exports: [DocumentsService, DocumentPostingRegistry],
})
export class DocumentsModule {}
