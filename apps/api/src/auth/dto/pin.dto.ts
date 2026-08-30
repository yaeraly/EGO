import { IsString, Matches } from 'class-validator';

/**
 * PIN format: 4-8 digits.
 *
 * The knowledge base does not state a PIN length; this range is an assumption
 * and is the single place to change it.
 */
const PIN_PATTERN = /^\d{4,8}$/;
const PIN_MESSAGE = 'pin must be 4 to 8 digits';

export class VerifyPinDto {
  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  pin!: string;
}

export class ChangePinDto {
  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  current_pin!: string;

  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  new_pin!: string;
}

export class ResetPinDto {
  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  new_pin!: string;
}

export { PIN_PATTERN, PIN_MESSAGE };
