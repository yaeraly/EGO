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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateAdvanceDto {
  @IsUUID()
  customer_id!: string;

  /** The reservation this backs, when it backs one (§17.3). */
  @IsOptional()
  @IsUUID()
  reservation_id?: string;

  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

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

export class RefundAdvanceDto {
  /**
   * Which accounts the cash leaves from (§35.5).
   *
   * Split refunds are explicitly allowed, so this is a list. Where the money
   * comes from is documented rather than inferred, and a source other than
   * the one the advance arrived on needs a reason.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundLineDto)
  lines!: RefundLineDto[];

  /** §17-А.4 — refunding money always takes a PIN. */
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin!: string;

  /** §35.5 rule 4: required when the money leaves another account. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  source_override_reason?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
