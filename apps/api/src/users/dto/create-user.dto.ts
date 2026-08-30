import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { user_role } from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';
import { PIN_MESSAGE, PIN_PATTERN } from '../../auth/dto/pin.dto';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  full_name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(32)
  phone!: string;

  @IsEnum(user_role)
  role!: user_role;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password is too long' })
  password!: string;

  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  pin!: string;

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
