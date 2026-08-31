import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateSalaryDto {
  @IsUUID()
  employee_id!: string;

  /** The month being paid for (§25: "мезгил"). */
  @IsInt()
  @Min(2000)
  @Max(2100)
  period_year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  period_month!: number;

  /** Left out, the employee's own base salary applies (§25). */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `base_amount ${DECIMAL_MESSAGE}` })
  base_amount?: string;

  /** §23's bonus, once it is calculated; entered by hand until then. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `bonus_amount ${DECIMAL_MESSAGE}` })
  bonus_amount?: string;

  /** Money already handed over during the month; it reduces the payout. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `advance_amount ${DECIMAL_MESSAGE}` })
  advance_amount?: string;

  /** §25 — a lawful or agreed deduction. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `deduction ${DECIMAL_MESSAGE}` })
  deduction?: string;

  @IsUUID()
  account_id!: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
