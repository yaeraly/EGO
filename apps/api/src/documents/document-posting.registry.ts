import { Injectable } from '@nestjs/common';
import { doc_type } from '@prisma/client';
import { DocumentPoster } from './document-poster';

@Injectable()
export class DocumentPostingRegistry {
  private readonly posters = new Map<doc_type, DocumentPoster>();

  register(poster: DocumentPoster): void {
    const existing = this.posters.get(poster.docType);
    if (existing && existing !== poster) {
      throw new Error(
        `Two posters registered for document type ${poster.docType}`,
      );
    }
    this.posters.set(poster.docType, poster);
  }

  /**
   * Undefined for a type with nothing to post. Document types are added module
   * by module, so a header-only type is expected, not an error.
   */
  get(docType: doc_type): DocumentPoster | undefined {
    return this.posters.get(docType);
  }
}
