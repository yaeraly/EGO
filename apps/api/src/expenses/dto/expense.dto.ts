import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateExpenseCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * §26 — a monthly ceiling the OWNER may set. It reports; it does not refuse:
   * "Келечекте категория боюнча айлык бюджет/лимит коюп, ашып кетсе эскертүү
   * берсе болот" describes a warning, not a block.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `monthly_budget ${DECIMAL_MESSAGE}` })
  monthly_budget?: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `monthly_budget ${DECIMAL_MESSAGE}` })
  monthly_budget?: string;
}

export class CreateExpenseDto {
  @IsUUID()
  category_id!: string;

  /** Which till or account it was paid from (§26). */
  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  /** §26 keeps a comment on every expense; it is what makes one auditable. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  comment!: string;
}
