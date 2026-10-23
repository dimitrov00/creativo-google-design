/**
 * The ops backfill jobs — the ONLY source of these strings, the job's own
 * tag field `backfillJobName` (N15: the name `BackfillJob` is the entity).
 * Runbook order: the subject mirror first, then the stats.
 *
 * The stored document id stays the legacy job string (`backfillJobs/
 * clientStats`, OQ-9 — a stable path key); `run-backfill.pipeline.ts`'
 * `BACKFILL_JOB_DOC` maps the two.
 */
export const BackfillJobName = {
  /** Mirrors the seat subjects onto the appointment's query keys. */
  SubjectMirror: 'SUBJECT_MIRROR',
  /** Recomputes every stored client's stats. */
  ClientStats: 'CLIENT_STATS',
} as const;
export type BackfillJobName =
  (typeof BackfillJobName)[keyof typeof BackfillJobName];
