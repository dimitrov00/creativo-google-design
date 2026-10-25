/**
 * Who reads a visit list — the ONLY source of these strings (moved from
 * `visit-list.system.ts`, values unchanged).
 */
export const VisitPerspective = {
  Client: 'CLIENT',
  Staff: 'STAFF',
} as const;
export type VisitPerspective =
  (typeof VisitPerspective)[keyof typeof VisitPerspective];
