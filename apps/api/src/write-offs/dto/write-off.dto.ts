import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class WriteOffLineDto {
  /** The LOT being scrapped — cost comes from it, never from an average. */
  @IsUUID()
  layer_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;
}

export class CreateWriteOffDto {
  /** §38.4 — goods leave the DEFECT warehouse. */
  @IsUUID()
  warehouse_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WriteOffLineDto)
  items!: WriteOffLineDto[];

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ConfirmWriteOffDto {
  /** Security: a write-off always takes a PIN. */
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin!: string;
}

/** §38 — the categories the schema names on `other_income.category`. */
export const OTHER_INCOME_CATEGORIES = ['METAL_SALE', 'OTHER'] as const;

export type OtherIncomeCategory = (typeof OTHER_INCOME_CATEGORIES)[number];

export class CreateOtherIncomeDto {
  @IsIn(OTHER_INCOME_CATEGORIES, {
    message: `category: ${OTHER_INCOME_CATEGORIES.join(', ')}`,
  })
  category!: OtherIncomeCategory;

  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /** §38.7 — which write-off the scrap came from. */
  @IsOptional()
  @IsUUID()
  linked_write_off?: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  /** §38 — "ар бир OIN милдеттүү түрдө категория жана булак менен документтелет". */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  source!: string;
}
