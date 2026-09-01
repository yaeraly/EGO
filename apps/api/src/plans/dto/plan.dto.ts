import {
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

export class UpsertPlanDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  period_year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  period_month!: number;

  /** Left out, the plan is the whole business's (§24). */
  @IsOptional()
  @IsUUID()
  user_id?: string;

  /**
   * Each target may be left out on its own.
   *
   * An absent target is not a target of zero: the report shows no percentage
   * for it rather than 0% or an infinite one.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `revenue_target ${DECIMAL_MESSAGE}` })
  revenue_target?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `margin_target ${DECIMAL_MESSAGE}` })
  margin_target?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  new_customers_target?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
