/**
 * A row's own outcome, as a list narrows by it — the ONLY source of these
 * strings (moved from `visit-list.system.ts`, values unchanged).
 */
export const VisitRowOutcome = {
  Open: 'OPEN',
  Worked: 'WORKED',
  NoShow: 'NO_SHOW',
  Cancelled: 'CANCELLED',
} as const;
export type VisitRowOutcome =
  (typeof VisitRowOutcome)[keyof typeof VisitRowOutcome];
