import { IsDefined, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class PutSettingDto {
  /**
   * Any JSON value, including null.
   *
   * Null is the explicit "not configured" state and must be accepted, while an
   * absent property is a mistake and must not be. IsDefined alone rejects
   * both, so validation is skipped for an explicit null and applied to
   * everything else — which leaves undefined as the only failing case.
   */
  @ValidateIf((_object, value) => value !== null)
  @IsDefined({ message: 'value is required (send null to unset)' })
  value!: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
