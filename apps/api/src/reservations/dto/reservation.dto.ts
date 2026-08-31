import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class ReservationLineDto {
  @IsUUID()
  product_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;
}

export class CreateReservationDto {
  /** §17.3: Walk-in cannot reserve, so a customer is always named. */
  @IsUUID()
  customer_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReservationLineDto)
  items!: ReservationLineDto[];

  /**
   * §17: an expiry date *and time* are mandatory. Left out, the OWNER's
   * default duration applies; with no default configured either, the request
   * is refused rather than given an invented deadline.
   */
  @IsOptional()
  @IsISO8601()
  expires_at?: string;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /**
   * §16.4 and §17.3 — the OWNER's reason for reserving past a block
   * (an overdue customer, or the active-reservation limit).
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  override_reason?: string;
}

export class CancelReservationDto {
  /** §17.3 keeps the cancel reason in the reservation audit. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
