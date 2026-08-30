import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { purchase_status } from '@prisma/client';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

export class PurchaseItemDto {
  @IsUUID()
  product_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;

  /** Supplier's price in CNY — purchases from China are priced in yuan (§4.1). */
  @Matches(DECIMAL_PATTERN, { message: `price_cny ${DECIMAL_MESSAGE}` })
  price_cny!: string;
}

export class CreatePurchaseDto {
  @IsUUID()
  supplier_id!: string;

  @IsOptional()
  @IsUUID()
  cargo_company_id?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'a purchase needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'business_date must be YYYY-MM-DD' })
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** Lines are replaced wholesale — simpler than per-line edits, and a DRAFT
 *  purchase is short-lived. */
export class ReplacePurchaseItemsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'a purchase needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}

export class UpdatePurchaseDto {
  @IsOptional()
  @IsUUID()
  cargo_company_id?: string;
}

export class AdvanceStatusDto {
  @IsEnum(purchase_status)
  status!: purchase_status;

  /** Required when the OWNER skips stages, so the jump is explainable (§6). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
