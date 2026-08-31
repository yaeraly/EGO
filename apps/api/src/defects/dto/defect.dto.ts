import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../../common/decimal';

/**
 * What was decided about the defective goods (§37).
 *
 * The four db/egomot_schema.sql names on `defect_acts.decision`. §36-А.3 is
 * where the choice comes from: warranty covers factory defects, and misuse,
 * mechanical damage, water or a short circuit do not — so a decision is a
 * judgement someone signs for, not a status the system derives.
 */
export const DEFECT_DECISIONS = ['EXCHANGE', 'REFUND', 'CLAIM', 'WRITEOFF'] as const;

export type DefectDecision = (typeof DEFECT_DECISIONS)[number];

export class CreateDefectDto {
  @IsUUID()
  product_id!: string;

  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty!: string;

  /** Where the defect came from: a customer return (§35) … */
  @IsOptional()
  @IsUUID()
  return_id?: string;

  /** … or damage found on arrival (§8.4, RECEIVING_DAMAGE). */
  @IsOptional()
  @IsUUID()
  discrepancy_id?: string;

  /** §37 — what is wrong with it, in the inspector's words. */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsIn(DEFECT_DECISIONS, { message: `decision: ${DEFECT_DECISIONS.join(', ')}` })
  decision?: DefectDecision;

  @IsOptional()
  @IsISO8601()
  business_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class DecideDefectDto {
  @IsIn(DEFECT_DECISIONS, { message: `decision: ${DEFECT_DECISIONS.join(', ')}` })
  decision!: DefectDecision;

  /** §36-А.3 — the finding the decision rests on. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}
