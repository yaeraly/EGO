import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateHandoverDto {
  /** Who takes responsibility next (§21). */
  @IsUUID()
  to_user!: string;

  @IsUUID()
  warehouse_id!: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class HandoverCountLineDto {
  @IsUUID()
  item_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `actual_qty ${DECIMAL_MESSAGE}` })
  actual_qty!: string;
}

export class HandoverCountDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HandoverCountLineDto)
  items!: HandoverCountLineDto[];
}

export class SignHandoverDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
