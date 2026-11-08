import type {
  AnalyticsRecomputeJobId,
  BarberId,
  BusyKey,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import type { RecomputeJobName } from './policy-recompute-job.entity';

/**
 * `backfillJobs/analyticsRecompute` — ONE budgeted pass over the stored
 * analytics days (staff analytics v2, «The recompute's job document»), on
 * the `PolicyRecomputeJob` model: the 04:30 sweep starts it, each step
 * handles one page of `PAGE_SIZE` busy keys (date-ascending, then barber in
 * `jobBarberIds` order), hands the ELIGIBLE keys — a day document missing
 * or carrying another `dayDefinitionVersion` — to `writeAnalyticsDay`, and
 * writes this document under the compare-and-set `jobStepKey`, which fires
 * the next step until the extent is exhausted. Only the recompute writes it.
 *
 * The extent is `jobWindowFromLocalDate` to the step's today: the full
 * reach (`jobFullReach`) when the definition version or the sorted barber
 * list changed since the last finished pass, else the window from the day
 * before that pass's date. Every instant is a lifecycle stamp (`*UtcMs`):
 * staleness is elapsed real time, compared through `UtcEpochMs` only
 * (flatten-spec T2). One flat archetype (Law 6).
 */
export type AnalyticsRecomputeJob = {
  readonly id: AnalyticsRecomputeJobId;
  readonly recomputeJobName: typeof RecomputeJobName.AnalyticsDays;
  /** The catalogue version this pass writes days under. */
  readonly jobDefinitionVersion: number;
  /** The sorted barber-record ids this pass walks — the list the next start compares with. */
  readonly jobBarberIds: readonly BarberId[];
  /** The extent's first day. */
  readonly jobWindowFromLocalDate: LocalDate;
  /** The last busy key handled; `null` at the top. */
  readonly jobCursor: BusyKey | null;
  /** The extent is the whole reach, not the window since the last pass. */
  readonly jobFullReach: boolean;
  readonly jobStartedAtUtcMs: UtcEpochMs;
  /** When the pass last MOVED — what the sweep measures staleness by. */
  readonly jobUpdatedAtUtcMs: UtcEpochMs;
  /** Set when the extent ran out; the job then rests until the next sweep. */
  readonly jobFinishedAtUtcMs: UtcEpochMs | null;
  /** The compare-and-set key of the step a delivery was fired for. */
  readonly jobStepKey: string;
  /** Set when a step could not move the pass and a redelivery cannot help. */
  readonly jobStalledAtUtcMs: UtcEpochMs | null;
  /** The canonical code of the failure that stalled the pass — codes only. */
  readonly jobLastFailureCode: string | null;
  /** Keys whose document was read. */
  readonly jobChecked: number;
  /** Of those, eligible days handed to the writer and written. */
  readonly jobWritten: number;
  /** Eligible days the writer could not write. */
  readonly jobFailed: number;
  /** Steps taken by this pass. */
  readonly jobSteps: number;
};
