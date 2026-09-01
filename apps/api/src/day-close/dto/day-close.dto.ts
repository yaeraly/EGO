import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateCashHandoverDto {
  /** Defaults to today in Bishkek. A closed day accepts no handover (§20). */
  @IsOptional()
  @IsISO8601()
  business_date?: string;

  /** The seller's own till the money is counted in and handed over from. */
  @IsUUID()
  from_account!: string;

  /** The central account the OWNER named for this (§19). */
  @IsUUID()
  to_account!: string;

  /** What was actually counted, which is not always what the system says. */
  @Matches(DECIMAL_PATTERN, { message: `actual_amount ${DECIMAL_MESSAGE}` })
  actual_amount!: string;

  /**
   * How much of it is handed over. Left out, the whole counted sum goes.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `handed_amount ${DECIMAL_MESSAGE}` })
  handed_amount?: string;

  /** Required whenever the count and the system disagree (§20). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  difference_reason?: string;
}

export class CloseDayDto {
  @IsString()
  @Length(4, 8)
  pin!: string;
}

export class CloseMonthDto {
  @IsString()
  @Length(4, 8)
  pin!: string;
}

export class ReopenMonthDto {
  @IsString()
  @Length(4, 8)
  pin!: string;

  /** Period Reopen is never silent — the reason is part of the record. */
  @IsString()
  @MinLength(10, {
    message: 'Кайра ачуунун себеби кеминде 10 белги болушу керек (Period Reopen)',
  })
  @MaxLength(1000)
  reason!: string;
}
