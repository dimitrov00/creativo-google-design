/**
 * The visit list funnel's options — the ONLY source of these strings (moved
 * from `visit-list.system.ts`, values unchanged).
 */
export const VisitFilter = {
  All: 'ALL',
  Upcoming: 'UPCOMING',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
  NoShow: 'NO_SHOW',
} as const;
export type VisitFilter = (typeof VisitFilter)[keyof typeof VisitFilter];
