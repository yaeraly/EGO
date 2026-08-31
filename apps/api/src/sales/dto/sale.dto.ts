import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class SaleItemDto {
  @IsUUID()
  product_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;

  /**
   * Per-unit price after any discount (§13.1).
   *
   * Omit it and the system's suggested price is used unchanged, which is the
   * common case and the fast path §1 asks for.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `final_price ${DECIMAL_MESSAGE}` })
  final_price?: string;

  /** Required whenever the price is below the suggestion (§13.1, §13.8). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  discount_reason?: string;
}

export class SalePaymentLineDto {
  /** The salesperson's own till or mobile-banking account (§19). */
  @IsUUID()
  account_id!: string;

  /** What lands in that account — for cash, net of any change given. */
  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /**
   * Cash the customer handed over, when it exceeds the amount (§15.1).
   * Change is derived from it; only a cash account may give change (§15.2).
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `cash_given ${DECIMAL_MESSAGE}` })
  cash_given?: string;
}

export class CreateSaleDto {
  /** Omit for a Walk-in sale (§11.1). */
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  /**
   * The reservation this sale fulfils (§17).
   *
   * With it, the lines and their prices come from the reservation instead of
   * the request: §17.1 fixes the price when the reservation is made, so the
   * customer is charged what they were quoted.
   */
  @IsOptional()
  @IsUUID()
  from_reservation?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'a sale needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentLineDto)
  payments?: SalePaymentLineDto[];

  /** Required when anything is left owed (§16). */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'debt_due_date must be YYYY-MM-DD' })
  debt_due_date?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  /** Loss sale (§13.6). OWNER only, and never an ordinary sale. */
  @IsOptional()
  @IsBoolean()
  is_loss_sale?: boolean;

  /** Mandatory for a loss sale (§13.6). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  loss_reason?: string;
}

export class SetPaymentsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentLineDto)
  payments?: SalePaymentLineDto[];

  /** Required when anything is left owed (§16). */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'debt_due_date must be YYYY-MM-DD' })
  debt_due_date?: string;
}

export class ConfirmSaleDto {
  /**
   * PIN, when the sale needs one (Security): a manual discount, a debt, or a
   * total at or above the configured threshold.
   */
  @IsOptional()
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4 to 8 digits' })
  pin?: string;

  /** OWNER's reason for pushing past a credit block (§16.5). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  credit_override_reason?: string;
}

export class ApproveDiscountDto {
  @IsBoolean()
  approved!: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
