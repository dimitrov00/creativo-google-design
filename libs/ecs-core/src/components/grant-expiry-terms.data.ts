import type { UtcEpochMs } from '@core/primitives';

/** Whether an active grant runs out at an instant — the field `grantExpiry`. */
export const GrantExpiry = {
  NoExpiry: 'NO_EXPIRY',
  ExpiresAt: 'EXPIRES_AT',
} as const;
export type GrantExpiry = (typeof GrantExpiry)[keyof typeof GrantExpiry];

/**
 * No expiry, or an absolute instant after which an active grant is no longer
 * usable — a flat variant slice of an ACTIVE grant (was the nested
 * `expiration: { kind, atMs }`).
 */
export type GrantExpiryTerms =
  GrantExpiryTerms.NoExpiry | GrantExpiryTerms.ExpiresAt;

const NO_EXPIRY: GrantExpiryTerms.NoExpiry = {
  grantExpiry: GrantExpiry.NoExpiry,
};

export const GrantExpiryTerms = {
  none(): GrantExpiryTerms.NoExpiry {
    return NO_EXPIRY;
  },

  at(atUtcMs: UtcEpochMs): GrantExpiryTerms.ExpiresAt {
    return { grantExpiry: GrantExpiry.ExpiresAt, grantExpiresAtUtcMs: atUtcMs };
  },

  /** The expiry slice of a value that carries one (an active grant), copied. */
  of(terms: GrantExpiryTerms): GrantExpiryTerms {
    return terms.grantExpiry === GrantExpiry.NoExpiry
      ? NO_EXPIRY
      : GrantExpiryTerms.at(terms.grantExpiresAtUtcMs);
  },
} as const;

export namespace GrantExpiryTerms {
  export type NoExpiry = { readonly grantExpiry: typeof GrantExpiry.NoExpiry };
  export type ExpiresAt = {
    readonly grantExpiry: typeof GrantExpiry.ExpiresAt;
    readonly grantExpiresAtUtcMs: UtcEpochMs;
  };
}
