import { claim_status, claim_type } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateClaimDto {
  /** The act this claim answers (§8.5: every claim links to its DIF). */
  @IsUUID()
  discrepancy_id!: string;

  @IsEnum(claim_type)
  ctype!: claim_type;

  /**
   * Claimed amount. Omit to take what the discrepancy is worth: the supplier
   * price of the missing goods plus, for a cargo claim, their share of the
   * freight actually paid (§8.5).
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class CompensateClaimDto {
  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /** Set when the compensation arrived as goods in a later batch (§8.7). */
  @IsOptional()
  @IsUUID()
  receipt_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateClaimStatusDto {
  @IsEnum(claim_status)
  cstatus!: claim_status;

  /** Mandatory for a write-off (§8.5). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  writeoff_reason?: string;
}
