import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateBonusPaymentDto {
  @IsUUID()
  employee_id!: string;

  @IsUUID()
  account_id!: string;

  /**
   * How much to pay out.
   *
   * Left out, everything currently PAYABLE for that employee is paid. Stated,
   * it must not exceed that — a bonus is paid from what the sales earned, not
   * from a figure someone typed.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount?: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
