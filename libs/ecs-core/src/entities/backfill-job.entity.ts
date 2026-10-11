import type { BackfillJobId, UserId } from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * The ops backfill jobs — the ONLY source of these strings, the job's own
 * tag field `backfillJobName` (N15: the name `BackfillJob` is the entity).
 * Runbook order: the subject mirror first, then the stats.
 *
 * The stored document id stays the legacy job string (`backfillJobs/
 * clientStats`) until flip (1) (OQ-9); the shim's table maps the two.
 */
export const BackfillJobName = {
  /** Mirrors the seat subjects onto the appointment's query keys. */
  SubjectMirror: 'SUBJECT_MIRROR',
  /** Recomputes every stored client's stats. */
  ClientStats: 'CLIENT_STATS',
} as const;
export type BackfillJobName =
  (typeof BackfillJobName)[keyof typeof BackfillJobName];

/**
 * A backfill's progress cursor — the stored body of `run-backfill.ts:561-572`
 * (blueprint §2.6), one flat archetype (Law 6). Each call resumes from
 * `cursor` and adds its page to the counts; `finishedAtUtcMs` is set when
 * the walk ran off the end. The closing check of a stats run — a sample of
 * stored clients recomputed from scratch (`run-backfill.ts:64-68`) — is the
 * 1-to-1 nullable `sample` flattened by prefix (N9): `sampleChecked` is
 * `null` when no sample was taken, and then `sampleMismatched` is `[]`.
 * The document body is this type minus `id`.
 */
export type BackfillJob = {
  readonly id: BackfillJobId;
  readonly backfillJobName: BackfillJobName;
  /** Opaque resume point; `null` at the top. */
  readonly cursor: string | null;
  /** Appointments walked by the whole run. */
  readonly processed: number;
  /** Stored `clientStats` documents walked. */
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
  readonly startedAtUtcMs: UtcEpochMs;
  readonly finishedAtUtcMs: UtcEpochMs | null;
  readonly updatedAtUtcMs: UtcEpochMs;
  /** Stored clients the closing sample recomputed; `null` when none was taken. */
  readonly sampleChecked: number | null;
  /** Clients whose stored answer differs from a fresh one — `UserId` until flip (1) (D29, §5.5). */
  readonly sampleMismatched: readonly UserId[];
};
