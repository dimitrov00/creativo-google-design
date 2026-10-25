/**
 * The grain a visit list is sectioned by — the ONLY source of these strings
 * (moved from `visit-list.system.ts`, values unchanged: a tag dictionary is
 * component-shaped data, Law 1 / pass D D-7.4).
 */
export const VisitGrain = {
  Month: 'MONTH',
  Year: 'YEAR',
} as const;
export type VisitGrain = (typeof VisitGrain)[keyof typeof VisitGrain];
