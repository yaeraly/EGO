import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { user_role, user_status } from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

/**
 * Credentials are not updatable here: a password or PIN change goes through
 * the dedicated endpoints, which log to the Security Log.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  full_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEnum(user_role)
  role?: user_role;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `max_discount_pct ${DECIMAL_MESSAGE}` })
  max_discount_pct?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `bonus_rate_pct ${DECIMAL_MESSAGE}` })
  bonus_rate_pct?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `base_salary ${DECIMAL_MESSAGE}` })
  base_salary?: string;
}

export class UpdateStatusDto {
  @IsEnum(user_status)
  status!: user_status;
}
