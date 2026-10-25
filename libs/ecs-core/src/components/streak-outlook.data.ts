/**
 * Where the rhythm stands as the card's line says it — the field
 * `streakOutlook` (Law 6), `StreakSystem.outlook`'s answer (Law 10.2: the
 * wallet words it, never decides it). In the order the answer is chosen:
 *
 * - `PAUSED` — booking is paused: the run is frozen where it stands.
 * - `IN_CHAIR` — today's visit in the chair keeps the run: the line names
 *   the day the next one is due by.
 * - `NOT_STARTED` — no visit counted yet: the first one starts the rhythm.
 * - `FROZEN` — a protection, an excuse or a pause carries the open period.
 * - `BROKEN_REPAIRABLE` — a period was missed and a visit by the repair day
 *   restores the run; `BROKEN_FINAL` — nothing can be restored any more.
 * - `HELD` — a visit on the book holds the open period.
 * - `DUE` — the run is healthy and the line names its due date;
 *   `DUE_NONE` — healthy with no due date to name.
 * - `AT_RISK` — the due date is near; `IN_GRACE` — past it, inside grace.
 */
export const StreakOutlook = {
  Paused: 'PAUSED',
  InChair: 'IN_CHAIR',
  NotStarted: 'NOT_STARTED',
  Frozen: 'FROZEN',
  BrokenRepairable: 'BROKEN_REPAIRABLE',
  BrokenFinal: 'BROKEN_FINAL',
  Held: 'HELD',
  Due: 'DUE',
  DueNone: 'DUE_NONE',
  AtRisk: 'AT_RISK',
  InGrace: 'IN_GRACE',
} as const;
export type StreakOutlook = (typeof StreakOutlook)[keyof typeof StreakOutlook];
