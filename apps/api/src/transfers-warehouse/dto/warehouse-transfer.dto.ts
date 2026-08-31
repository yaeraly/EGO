import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class TransferItemDto {
  /** The FIFO layer being moved — cost travels with it (§12-А.5). */
  @IsUUID()
  layer_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;
}

export class CreateTransferDto {
  @IsUUID()
  from_warehouse!: string;

  @IsUUID()
  to_warehouse!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'a transfer needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
