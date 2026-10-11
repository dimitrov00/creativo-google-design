/**
 * A grant's lifecycle state — the field `grantStatus`, the ONLY source of
 * these strings. The stored legacy values are the lower-case
 * `couponGrants.state.kind` tags (the rules key is `state`,
 * `firestore.rules:198`, until the engagement flip).
 */
export const GrantStatus = {
  Active: 'ACTIVE',
  Used: 'USED',
  Expired: 'EXPIRED',
  Revoked: 'REVOKED',
} as const;
export type GrantStatus = (typeof GrantStatus)[keyof typeof GrantStatus];
