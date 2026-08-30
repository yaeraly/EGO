import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { account_type, currency_code } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEnum(account_type)
  type!: account_type;

  @IsEnum(currency_code)
  currency!: currency_code;

  /** Null for a company account; a user id for a seller's own till. */
  @IsOptional()
  @IsUUID()
  owner_user?: string;
}

/**
 * Currency and type are absent by design: movements already booked to the
 * account were recorded in its currency, so changing it would reinterpret
 * history.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsUUID()
  owner_user?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
