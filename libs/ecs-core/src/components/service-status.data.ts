/**
 * A service is bookable (`ACTIVE`) or kept for history only (`ARCHIVED`) —
 * the ONLY source of these strings, named after the field it types
 * (`serviceStatus`, Law 1, N8/N15; was `status`, flatten-spec §3.1). Values
 * SCREAMING_SNAKE (Law 6.2); the composite indexes filter the stored field.
 * A plain field an admin flips, not a transition graph — nothing to compute
 * on it beyond `===` against a tag. Split out of `catalog-status.data.ts`
 * (pass D, D-7: one dictionary per file).
 */
export const ServiceStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED',
} as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];
