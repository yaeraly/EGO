import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateTransferDto {
  @IsUUID()
  from_account!: string;

  @IsUUID()
  to_account!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /** Defaults to today in Bishkek (Period Lock: Business Date). */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
