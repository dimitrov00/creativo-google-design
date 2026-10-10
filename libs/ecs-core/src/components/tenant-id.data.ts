/**
 * The tenant a document belongs to — a brand over the plain stored string
 * (§9 D13: it survives on `OtpEntity.tenantId`, `Principal.tenantId` and the
 * auth claims). The models lib's `TenantId` class (`ids.ts:15`), minus the
 * class: two ids declared this way are nominal, with zero runtime cost.
 */
export type TenantId = string & { readonly __brand: unique symbol };

export const TenantId = {
  /** The only cast site. Validate a raw string with `parse` at the edge, not here. */
  of: (raw: string): TenantId => raw as TenantId,

  /**
   * The edge guard (a token claim, a callable payload): a blank or
   * whitespace-only id is no id, so `null`; anything else is kept exactly as
   * given, untrimmed — the models `createId` invariant. The caller words the
   * refusal in its own context's code.
   */
  parse(raw: string): TenantId | null {
    return raw.trim().length === 0 ? null : TenantId.of(raw);
  },

  equals(a: TenantId, b: TenantId): boolean {
    return a === b;
  },
} as const;
