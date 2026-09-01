import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVehicleModelDto {
  /** The make, where it is known — plenty of tricycles arrive without one. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateVehicleModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class LinkCompatibilityDto {
  @IsUUID()
  model_id!: string;

  /** What was checked, or where the claim came from. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
