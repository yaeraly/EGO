import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { capital_source } from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateInvestorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class UpdateInvestorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateCapitalDto {
  @IsEnum(capital_source)
  source!: capital_source;

  /** Required when source is INVESTOR — the schema enforces it too. */
  @IsOptional()
  @IsUUID()
  investor_id?: string;

  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /**
   * KGS per unit of the account's currency. Required for a foreign-currency
   * account, ignored for KGS.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `rate ${DECIMAL_MESSAGE}` })
  rate?: string;

  /** Defaults to today in Bishkek (Period Lock: Business Date). */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
