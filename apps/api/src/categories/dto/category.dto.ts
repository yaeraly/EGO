import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Product category (§12-Б.1).
 *
 * A name people recognise, the warranty a product in it carries when it does
 * not set its own (§12-Б.7, §36-А.1), and the prefix its parts' SKUs are
 * issued under. Everything else about a product belongs to the product.
 */
export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * §36-А.1: the OWNER sets these per category — motors 30 days, small parts
   * 0. Zero is a real answer, so it is the default rather than a refusal.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  default_warranty_days?: number;

  /**
   * The SKU prefix for this category's parts, e.g. MOT.
   *
   * Left out, products fall back to PRD. Latin letters and digits only: an
   * SKU is read aloud across a warehouse and typed into a phone.
   */
  @IsOptional()
  @IsString()
  @MaxLength(6)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'code may contain only Latin letters and digits',
  })
  code?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  default_warranty_days?: number;

  /**
   * The SKU prefix for this category's parts, e.g. MOT.
   *
   * Left out, products fall back to PRD. Latin letters and digits only: an
   * SKU is read aloud across a warehouse and typed into a phone.
   */
  @IsOptional()
  @IsString()
  @MaxLength(6)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'code may contain only Latin letters and digits',
  })
  code?: string;
}
