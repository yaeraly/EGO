import { discrepancy_status, discrepancy_type } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDiscrepancyDto {
  /** UNKNOWN is reclassified once the cause is established (§8.4). */
  @IsOptional()
  @IsEnum(discrepancy_type)
  dtype?: discrepancy_type;

  @IsOptional()
  @IsEnum(discrepancy_status)
  dstatus?: discrepancy_status;

  /** Required for a write-off (§8.5); free text otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  financial_decision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
