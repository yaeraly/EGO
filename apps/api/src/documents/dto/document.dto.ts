import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { doc_status, doc_type } from '@prisma/client';

export class CreateDocumentDto {
  @IsEnum(doc_type)
  doc_type!: doc_type;

  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateCommentDto {
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  comment!: string | null;
}

export class CancelDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsEnum(doc_type)
  doc_type?: doc_type;

  @IsOptional()
  @IsEnum(doc_status)
  status?: doc_status;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;
}
