import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { documents } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { parseBusinessDate } from './business-date';
import { DocumentsService } from './documents.service';
import {
  CancelDocumentDto,
  CreateDocumentDto,
  ListDocumentsQueryDto,
  UpdateCommentDto,
} from './dto/document.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  create(
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.documents.createStandalone({
      docType: dto.doc_type,
      businessDate: parseBusinessDate(dto.business_date),
      userId: user.id,
      comment: dto.comment ?? null,
    });
  }

  @Get()
  findMany(@Query() query: ListDocumentsQueryDto): Promise<documents[]> {
    return this.documents.findMany({
      docType: query.doc_type,
      status: query.status,
      businessDate: query.business_date
        ? parseBusinessDate(query.business_date)
        : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<documents> {
    return this.documents.findOne(id);
  }

  /** Rejected with 409 once the document leaves DRAFT. */
  @Patch(':id')
  updateComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.documents.updateComment(id, user.id, dto.comment);
  }

  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.documents.confirm(id, user.id);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.documents.cancel(id, user.id, dto.reason ?? null);
  }
}
