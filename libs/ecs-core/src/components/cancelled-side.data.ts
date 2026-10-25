/**
 * Who called a visit off, as the row says it — the ONLY source of these
 * strings (moved from `visit-story.system.ts`, values unchanged). The
 * statistics' side rule (`VisitStorySystem.cancelledSide`) answers in it.
 */
export const CancelledSide = {
  Client: 'CLIENT',
  Shop: 'SHOP',
} as const;
export type CancelledSide = (typeof CancelledSide)[keyof typeof CancelledSide];
