import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

/** §4.1 names the three channels money reaches the Chinese partner by. */
export const SUPPLIER_PAYMENT_CHANNELS = ['ALIPAY', 'WECHAT', 'BANK'] as const;
export type SupplierPaymentChannel = (typeof SUPPLIER_PAYMENT_CHANNELS)[number];

export class CreateSupplierPaymentDto {
  @IsUUID()
  supplier_id!: string;

  /** The CNY till the money leaves (§10-А.1). */
  @IsUUID()
  from_account!: string;

  @Matches(DECIMAL_PATTERN, { message: `amount_cny ${DECIMAL_MESSAGE}` })
  amount_cny!: string;

  @IsOptional()
  @IsIn(SUPPLIER_PAYMENT_CHANNELS as unknown as string[], {
    message: `channel must be one of ${SUPPLIER_PAYMENT_CHANNELS.join(', ')}`,
  })
  channel?: SupplierPaymentChannel;

  /**
   * The order being paid for, when there is one. Optional: §4.2 tracks the
   * supplier's balance as a whole, so a payment against general debt is
   * normal.
   */
  @IsOptional()
  @IsUUID()
  purchase_id?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
