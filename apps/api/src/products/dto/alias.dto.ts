import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The kinds db/egomot_schema.sql names on `product_aliases.kind`: a Russian or
 * Kyrgyz name, what the Chinese supplier calls it, a search keyword, or an OEM
 * code. OTHER is the column's own default.
 */
export const ALIAS_KINDS = ['RU', 'KG', 'SUPPLIER', 'KEYWORD', 'OEM', 'OTHER'] as const;

export type AliasKind = (typeof ALIAS_KINDS)[number];

export class CreateAliasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  alias!: string;

  @IsOptional()
  @IsIn(ALIAS_KINDS, { message: `kind: ${ALIAS_KINDS.join(', ')}` })
  kind?: AliasKind;
}
