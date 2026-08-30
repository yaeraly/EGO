import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { withdrawal_type } from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateWithdrawalDto {
  @IsEnum(withdrawal_type)
  wtype!: withdrawal_type;

  /** Required for INVESTOR_CAPITAL_RETURN — the return has to name a payee. */
  @IsOptional()
  @IsUUID()
  investor_id?: string;

  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /** The capital contribution being returned, where one applies (§3.1.4). */
  @IsOptional()
  @IsUUID()
  linked_capital_doc?: string;

  @IsString()
  @MinLength(1, { message: 'purpose is required (§3.1.4)' })
  @MaxLength(1000)
  purpose!: string;

  /** Defaults to today in Bishkek (Period Lock: Business Date). */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
