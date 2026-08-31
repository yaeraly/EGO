import { customer_category, customer_type } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEnum(customer_type)
  ctype?: customer_type;

  /**
   * A personal credit limit that replaces the category default (§16.1).
   * OWNER only — the controller enforces that.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `individual_credit_limit ${DECIMAL_MESSAGE}` })
  individual_credit_limit?: string;
}

export class UpdateCustomerDto {
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
  @IsEnum(customer_type)
  ctype?: customer_type;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `individual_credit_limit ${DECIMAL_MESSAGE}` })
  individual_credit_limit?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class SetCategoryDto {
  @IsEnum(customer_category)
  category!: customer_category;

  /**
   * A manual category outranks the automatic calculation and stops it from
   * touching this customer again (§12.1), so it needs a stated reason.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
