import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Correction Type (Period Lock — Correction/Reversal).
 *
 * Only a full reversal today: it is the one correction whose effect the
 * system can derive exactly, from the movements the original made. A partial
 * value correction would need a rule for how the new value is re-posted, and
 * the knowledge base does not state one.
 */
export const CORRECTION_TYPES = ['REVERSAL'] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export class CreateCorrectionDto {
  @IsUUID()
  original_document_id!: string;

  @IsIn(CORRECTION_TYPES)
  correction_type!: CorrectionType;

  /** Mandatory (§27.1, Closed Period Correction) — and not a shrug. */
  @IsString()
  @MinLength(10, {
    message: 'Коррекциянын себеби кеминде 10 белги болушу керек (§27.1)',
  })
  @MaxLength(1000)
  reason!: string;

  /**
   * Which period the correction belongs to (Business/Effective Date).
   *
   * Defaults to the original document's own business date: an August error
   * found in September is still August's. The system's own record of when it
   * was entered is the document's created_at, which is never backdated.
   */
  @IsOptional()
  @IsISO8601()
  effective_date?: string;
}

export class ConfirmCorrectionDto {
  @IsString()
  @Length(4, 8)
  pin!: string;
}
