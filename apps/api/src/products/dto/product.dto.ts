import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
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

  /**
   * Dimensions and volumetric weight (§9.4).
   *
   * Optional in general, but an expense allocated by VOLUME refuses to
   * confirm a receipt without one of these on every line it touches, because
   * a light bulky part would otherwise carry a freight share set by its
   * weight — which is exactly the distortion §9.4 exists to prevent.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `length_cm ${DECIMAL_MESSAGE}` })
  length_cm?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `width_cm ${DECIMAL_MESSAGE}` })
  width_cm?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `height_cm ${DECIMAL_MESSAGE}` })
  height_cm?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `volume_m3 ${DECIMAL_MESSAGE}` })
  volume_m3?: string;

  /** What the carrier bills by, when it bills by volume (§9.4). */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `chargeable_weight_kg ${DECIMAL_MESSAGE}` })
  chargeable_weight_kg?: string;

  /** The product's own markup, in percent — the first level of §13. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `base_markup_pct ${DECIMAL_MESSAGE}` })
  base_markup_pct?: string;

  /** The floor an ordinary sale may not go under (§13.2). */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `min_selling_price ${DECIMAL_MESSAGE}` })
  min_selling_price?: string;

  @IsOptional()
  @IsUUID()
  main_supplier_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplier_product_code?: string;

  /** §12-Б.1 — free text on the card; also searched. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * §12-Б.7: how long the warranty runs for this product. Left unset, the
   * category's default applies (§36-А.1) — and 0 is a deliberate "no
   * warranty", which is why it is not the same as leaving it out.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  warranty_days?: number;

  /** §12-Б.8 — which tricycle models the part fits, as plain text in the MVP. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  compatibility_notes?: string;

  /** §12-Б.4 — the OWNER's stock thresholds; the stock itself is never set here. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `min_stock ${DECIMAL_MESSAGE}` })
  min_stock?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `reorder_point ${DECIMAL_MESSAGE}` })
  reorder_point?: string;
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

  /**
   * Dimensions and volumetric weight (§9.4).
   *
   * Optional in general, but an expense allocated by VOLUME refuses to
   * confirm a receipt without one of these on every line it touches, because
   * a light bulky part would otherwise carry a freight share set by its
   * weight — which is exactly the distortion §9.4 exists to prevent.
   */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `length_cm ${DECIMAL_MESSAGE}` })
  length_cm?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `width_cm ${DECIMAL_MESSAGE}` })
  width_cm?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `height_cm ${DECIMAL_MESSAGE}` })
  height_cm?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `volume_m3 ${DECIMAL_MESSAGE}` })
  volume_m3?: string;

  /** What the carrier bills by, when it bills by volume (§9.4). */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `chargeable_weight_kg ${DECIMAL_MESSAGE}` })
  chargeable_weight_kg?: string;

  /** The product's own markup, in percent — the first level of §13. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `base_markup_pct ${DECIMAL_MESSAGE}` })
  base_markup_pct?: string;

  /** The floor an ordinary sale may not go under (§13.2). */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `min_selling_price ${DECIMAL_MESSAGE}` })
  min_selling_price?: string;

  @IsOptional()
  @IsUUID()
  main_supplier_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplier_product_code?: string;

  /** §12-Б.1 — free text on the card; also searched. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * §12-Б.7: how long the warranty runs for this product. Left unset, the
   * category's default applies (§36-А.1) — and 0 is a deliberate "no
   * warranty", which is why it is not the same as leaving it out.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  warranty_days?: number;

  /** §12-Б.8 — which tricycle models the part fits, as plain text in the MVP. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  compatibility_notes?: string;

  /** §12-Б.4 — the OWNER's stock thresholds; the stock itself is never set here. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `min_stock ${DECIMAL_MESSAGE}` })
  min_stock?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `reorder_point ${DECIMAL_MESSAGE}` })
  reorder_point?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
