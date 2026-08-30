import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateCurrencyExchangeDto {
  @IsUUID()
  from_account!: string;

  @IsUUID()
  to_account!: string;

  /** What actually left from_account, in its currency. */
  @Matches(DECIMAL_PATTERN, { message: `given_amount ${DECIMAL_MESSAGE}` })
  given_amount!: string;

  /** What actually arrived in to_account, in its currency. */
  @Matches(DECIMAL_PATTERN, { message: `received_amount ${DECIMAL_MESSAGE}` })
  received_amount!: string;

  /**
   * The dealer's fee, for the record. It is not a separate movement: the
   * amounts above are what actually moved, so a fee taken off the top is
   * already inside them.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `commission ${DECIMAL_MESSAGE}` })
  commission?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  intermediary?: string;

  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
