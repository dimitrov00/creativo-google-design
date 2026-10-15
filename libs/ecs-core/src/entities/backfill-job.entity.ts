import type { BackfillJobId, CustomerId, UtcEpochMs } from '@core/primitives';
import type { BackfillJobName } from '@core/components';

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
  /** Client records whose stored answer differs from a fresh one (D29). */
  readonly sampleMismatched: readonly CustomerId[];
};
