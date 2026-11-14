/**
 * How far a capability reaches for one staff level — the field
 * `accessScope`, the ONLY source of these strings
 * (`docs/designs/staff-permissions.md`, P3). Not "grant scope": coupon
 * grants own that word.
 */
export const AccessScope = {
  /** Nobody on the level. */
  None: 'NONE',
  /** Only the barber record the account is linked to — offered on the barber level alone. */
  Own: 'OWN',
  /** Every barber and the shop. */
  All: 'ALL',
} as const;
export type AccessScope = (typeof AccessScope)[keyof typeof AccessScope];
