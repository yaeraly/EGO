import { Injectable } from '@nestjs/common';
import { doc_type } from '@prisma/client';
import { DocumentPoster } from './document-poster';

@Injectable()
export class DocumentPostingRegistry {
  private readonly posters = new Map<doc_type, DocumentPoster>();

  register(poster: DocumentPoster): void {
    for (const docType of [poster.docType, ...(poster.alsoPosts ?? [])]) {
      const existing = this.posters.get(docType);
      if (existing && existing !== poster) {
        throw new Error(`Two posters registered for document type ${docType}`);
      }
      this.posters.set(docType, poster);
    }
  }

  /**
   * Undefined for a type with nothing to post. Document types are added module
   * by module, so a header-only type is expected, not an error.
   */
  get(docType: doc_type): DocumentPoster | undefined {
    return this.posters.get(docType);
  }
}
