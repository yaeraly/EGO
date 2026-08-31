import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  currency_code,
  expense_alloc_basis,
  rate_source,
  receipt_expense_type,
} from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateReceiptDto {
  /** The order being received (§7: a receipt always comes from a purchase). */
  @IsUUID()
  purchase_id!: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReceiptLineDto {
  @IsUUID()
  product_id!: string;

  /** What actually arrived — may differ from the order (§8.1). */
  @Matches(DECIMAL_PATTERN, { message: `received_qty ${DECIMAL_MESSAGE}` })
  received_qty!: string;

  /**
   * How many of those are damaged (§8.4). They are still received, and carry
   * the same landed cost, but go straight to DEFECT rather than MAIN.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `damaged_qty ${DECIMAL_MESSAGE}` })
  damaged_qty?: string;
}

export class UpdateReceiptLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

export class ManualAllocationDto {
  @IsUUID()
  receipt_item_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount_kgs ${DECIMAL_MESSAGE}` })
  amount_kgs!: string;
}

export class CreateExpenseDto {
  @IsEnum(receipt_expense_type)
  etype!: receipt_expense_type;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  @IsEnum(currency_code)
  currency!: currency_code;

  /** Required unless the expense is already in som (§10.1). */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `rate ${DECIMAL_MESSAGE}` })
  rate?: string;

  @IsOptional()
  @IsEnum(rate_source)
  rate_source?: rate_source;

  /** Each expense chooses its own basis (§9.2), defaulting to WEIGHT. */
  @IsOptional()
  @IsEnum(expense_alloc_basis)
  alloc_basis?: expense_alloc_basis;

  @IsOptional()
  @IsBoolean()
  is_paid?: boolean;

  /** MANUAL only (§9.6): the OWNER's own split, per receipt line. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualAllocationDto)
  manual_allocations?: ManualAllocationDto[];
}

export class SetRatesDto {
  /**
   * KGS per CNY for the goods. Omit to take the system's suggestion, which
   * follows §10.1; supplying one records the source as MANUAL.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `rate_cny ${DECIMAL_MESSAGE}` })
  rate_cny?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `rate_usd ${DECIMAL_MESSAGE}` })
  rate_usd?: string;
}
