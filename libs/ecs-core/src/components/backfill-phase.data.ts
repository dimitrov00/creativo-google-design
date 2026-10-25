/*
 * The two walks an ops backfill run makes (`BackfillPlanSystem`). A tag
 * dictionary is a component (D-7); moved out of `backfill-plan.system.ts`
 * (pass D, S-21), values unchanged — they reach the wire cursor only through
 * the system's own `~` mark, never as these strings.
 */

/**
 * The two walks a run makes — the ONLY source of these strings, the field
 * `backfillPhase`. Every job pages the appointments; `CLIENT_STATS` then
 * pages the stored `clientStats` documents themselves, because a person no
 * appointment names any more is reachable only from their own document
 * (§12.4 P0).
 */
export const BackfillPhase = {
  Appointments: 'APPOINTMENTS',
  StoredClients: 'STORED_CLIENTS',
} as const;
export type BackfillPhase = (typeof BackfillPhase)[keyof typeof BackfillPhase];
