import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { return_condition } from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class ReturnLineDto {
  /** Which line of the original sale is coming back (§35.1). */
  @IsUUID()
  sale_item_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;

  /**
   * §35.2.5 — resalable goods go back to MAIN, defective ones to DEFECT.
   * §42.12 is the rule this enforces: a defective item never rejoins ordinary
   * stock.
   */
  @IsEnum(return_condition)
  condition!: return_condition;
}

export class CreateReturnDto {
  /** §35.1.1: a return always names the sale it reverses — no exception. */
  @IsUUID()
  original_sale!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items!: ReturnLineDto[];

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class RefundLineDto {
  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;
}

export class ConfirmReturnDto {
  /** Security: a return always takes a PIN. */
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin!: string;

  /**
   * Where the cash leaves from (§35.5).
   *
   * Empty when the customer's debt swallowed the whole return (§35.4). A
   * split across accounts is explicitly allowed, so this is a list.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundLineDto)
  refunds?: RefundLineDto[];

  /** §35.5.4 — required when the money leaves another account. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  source_override_reason?: string;

  /**
   * §36-А.2 — the OWNER's reason for accepting a defective return whose
   * warranty has run out. Nobody else may confirm one at all.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  warranty_exception_reason?: string;
}
