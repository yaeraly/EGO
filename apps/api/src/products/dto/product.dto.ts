import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

/**
 * Minimal Product Master.
 *
 * §12-Б describes a much larger card — aliases and search keywords, volume and
 * chargeable weight, warranty days, pricing policy, compatibility notes. None
 * of that is needed to order goods, and each belongs to the module that first
 * uses it (weight becomes mandatory at Receipt, §9.1; pricing at Sale, §13).
 * What is here is what a Purchase line needs: something to point at, with an
 * SKU a person can read.
 */
export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  oem_code?: string;

  /** §9.1 makes this mandatory at Receipt; optional until then. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `weight_kg ${DECIMAL_MESSAGE}` })
  weight_kg?: string;

  @IsOptional()
  @IsUUID()
  main_supplier_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplier_product_code?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  oem_code?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `weight_kg ${DECIMAL_MESSAGE}` })
  weight_kg?: string;

  @IsOptional()
  @IsUUID()
  main_supplier_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplier_product_code?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
