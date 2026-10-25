/**
 * A shop is listed (`ACTIVE`) or withheld from every public surface
 * (`HIDDEN`) — the ONLY source of these strings, named after the field it
 * types (`locationStatus`, Law 1, N8/N15; was `status`, flatten-spec §3.1).
 * Values SCREAMING_SNAKE (Law 6.2); the composite indexes filter the stored
 * field. Split out of `catalog-status.data.ts` (pass D, D-7: one dictionary
 * per file).
 */
export const LocationStatus = {
  Active: 'ACTIVE',
  Hidden: 'HIDDEN',
} as const;
export type LocationStatus =
  (typeof LocationStatus)[keyof typeof LocationStatus];
