import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Product category (§12-Б.1).
 *
 * Two fields, because the table has two: a name people recognise, and the
 * warranty a product in it carries when it does not set its own (§12-Б.7,
 * §36-А.1). Everything else about a product belongs to the product.
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
}
