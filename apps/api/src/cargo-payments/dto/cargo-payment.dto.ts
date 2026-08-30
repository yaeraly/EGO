import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class CreateCargoPaymentDto {
  @IsUUID()
  cargo_company_id!: string;

  /**
   * The account the money leaves. Its currency decides how the payment works:
   * a USD till draws on the currency FIFO, a KGS account needs a rate (§5.2).
   */
  @IsUUID()
  from_account!: string;

  /** In the account's own currency — what actually leaves it. */
  @Matches(DECIMAL_PATTERN, { message: `amount ${DECIMAL_MESSAGE}` })
  amount!: string;

  /**
   * KGS per USD. Required when paying in som, because the cargo debt is in
   * dollars and §5.2 requires the rate used to be recorded. Ignored when
   * paying from a USD till, where the real rate comes from the FIFO layers.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `rate ${DECIMAL_MESSAGE}` })
  rate?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
