import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

export class CreateInventoryDto {
  @IsUUID()
  warehouse_id!: string;

  /** §22 — a full count, or a spot check of named products. */
  @IsOptional()
  @IsBoolean()
  is_full?: boolean;

  /** Required for a partial count; ignored for a full one. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  product_ids?: string[];

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class CountLineDto {
  @IsUUID()
  line_id!: string;

  /** What was actually on the shelf. */
  @Matches(DECIMAL_PATTERN, { message: `actual_qty ${DECIMAL_MESSAGE}` })
  actual_qty!: string;

  /**
   * The LOT the shortage was traced to (§22).
   *
   * Named when the counter can tell which batch is missing; left out, the
   * shortage comes off the oldest available layer, FIFO.
   */
  @IsOptional()
  @IsUUID()
  layer_id?: string;

  /** Who answers for this line (§22: "жооптуу адам көрсөтүлөт"). */
  @IsOptional()
  @IsUUID()
  responsible?: string;
}

export class CountDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  lines!: CountLineDto[];
}

export class ExcessCostDto {
  @IsUUID()
  line_id!: string;

  /**
   * What the surplus is worth (§22).
   *
   * §22 has the OWNER value it — "болжолдуу/аныкталган нарк менен, OPENING
   * LOT логикасына окшош" — so it is stated here rather than guessed from
   * some other layer's cost.
   */
  @Matches(DECIMAL_PATTERN, { message: `unit_cost ${DECIMAL_MESSAGE}` })
  unit_cost!: string;
}

export class ConfirmInventoryDto {
  /** Security: an Inventory Adjustment always takes a PIN. */
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin!: string;

  /** §22 — the OWNER's documented reason for the adjustment. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExcessCostDto)
  excess_costs?: ExcessCostDto[];
}
