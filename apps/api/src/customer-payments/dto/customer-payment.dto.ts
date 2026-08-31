import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class PaymentLineDto {
  @IsUUID()
  account_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;
}

export class ManualAllocationDto {
  @IsUUID()
  sale_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;
}

export class CreateCustomerPaymentDto {
  @IsUUID()
  customer_id!: string;

  /** Where the money lands, split across channels if need be (§16-А.3). */
  @IsArray()
  @ArrayMinSize(1, { message: 'a payment needs at least one channel' })
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  lines!: PaymentLineDto[];

  /**
   * Which debts to close, when the cashier chooses (§16-А.2).
   *
   * Omit it and the payment closes the oldest debts first, which is the
   * default §16-А.1 sets.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualAllocationDto)
  allocations?: ManualAllocationDto[];

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
