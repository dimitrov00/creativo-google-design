import { type RepositoryError, Result } from '@core/primitives';
import { PreciseInstant, type WriteOp } from '@core/components';
import type { PolicyRecomputeJob } from '@core/entities';
import type { TelemetryPorts, TxPorts } from '@core/ports';
import {
  type AttemptFailure,
  type LivePolicyLine,
  PolicyRecomputeJobSystem,
} from '@core/systems';
import { repositoryFailure } from './project-client-stats.pipeline';
import {
  POLICY_RECOMPUTE_JOB_PATH,
  policyJobWrite,
} from './start-policy-recompute.pipeline';

/**
 * `sweepPolicyRecompute` — the pass's only automatic restart, and the repair
 * for a start that never happened (`recompute-on-policy-change.ts`,
 * blueprint §4.1), once a day:
 *
 * - FIRST, a dropped start: when the policy document changed after the
 *   change the job answers and draws another line than the job
 *   (`PolicyRecomputeJobSystem.catchUp`), the pass it owes starts from the
 *   top under a `sweep:` generation;
 * - otherwise, a stalled pass: an unfinished pass that has not moved for an
 *   hour is nudged (`nudge`) — one write that fires its step again, under
 *   the same compare-and-set as any delivery.
 *
 * The policy line is read OUTSIDE the transaction, like every policy read.
 * Idempotent: a started pass records the document's update time as its
 * change, and a nudge keeps the step's key.
 */

/**
 * The booking policy's line and when it last changed — `settings/bookingPolicy`
 * (its `cancellationWindowHours` through `BookingPolicy.withDefaults`, and
 * the document's `updateTime`; `null` with no document). A port the
 * booking-core flip adds for the sweep; its home is `scheduling.port.ts`
 * (reported to the integrator).
 */
export type LoadPolicyLine = () => Promise<
  Result<LivePolicyLine, RepositoryError>
>;

/** What the daily sweep did to the job — the ONLY source of these strings, the field `policySweepOutcome`. */
export const PolicySweepOutcome = {
  /** No job, a finished one, or one that moved within the hour — and no dropped change. */
  Idle: 'IDLE',
  /** A policy change whose start was dropped: its pass started from the top. */
  Started: 'STARTED',
  /** An unfinished pass that had stopped moving: its step fired again. */
  Nudged: 'NUDGED',
  /** The policy or the job could not be read or written. */
  Failed: 'FAILED',
} as const;
export type PolicySweepOutcome =
  (typeof PolicySweepOutcome)[keyof typeof PolicySweepOutcome];

export type PolicySweepReport = {
  readonly policySweepOutcome: PolicySweepOutcome;
  /** The failure the sweep answers with — the edge retries it when a redelivery can help. */
  readonly attemptFailure: AttemptFailure | null;
  readonly survivedFailure: AttemptFailure | null;
};

export type SweepPolicyRecomputePorts = Pick<TxPorts, 'commit' | 'nowUtcMs'> &
  Pick<TelemetryPorts, 'log'> & {
    readonly loadPolicyLine: LoadPolicyLine;
  };

/** A change instant as the label of the generation it starts — whole seconds, then the nine nanosecond digits. */
function instantLabel(instant: PreciseInstant): string {
  return `${instant.seconds}.${String(instant.nanos).padStart(9, '0')}`;
}

function failed(failure: AttemptFailure): PolicySweepReport {
  return {
    policySweepOutcome: PolicySweepOutcome.Failed,
    attemptFailure: failure,
    survivedFailure: null,
  };
}

export const sweepPolicyRecompute =
  (ports: SweepPolicyRecomputePorts) =>
  async (): Promise<Result<PolicySweepReport, never>> => {
    // Outside the transaction: tuning data never widens the job's conflict set.
    const live = await ports.loadPolicyLine();
    if (!live.ok) return Result.ok(failed(repositoryFailure(live.error)));
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => tx.get<PolicyRecomputeJob>(POLICY_RECOMPUTE_JOB_PATH),
      (
        job,
      ): Result<
        {
          readonly policySweepOutcome: PolicySweepOutcome;
          readonly job: PolicyRecomputeJob | null;
          readonly writes: readonly WriteOp[];
        },
        never
      > => {
        const owed = PolicyRecomputeJobSystem.catchUp(
          job,
          live.value,
          nowUtcMs,
          instantLabel(
            live.value.updatedAt ?? PreciseInstant.fromEpochMs(nowUtcMs),
          ),
        );
        if (owed !== null) {
          return Result.ok({
            policySweepOutcome: PolicySweepOutcome.Started,
            job: owed,
            writes: [policyJobWrite(owed)],
          });
        }
        const next = PolicyRecomputeJobSystem.nudge(job, nowUtcMs);
        if (next === null || job === null) {
          return Result.ok({
            policySweepOutcome: PolicySweepOutcome.Idle,
            job,
            writes: [],
          });
        }
        return Result.ok({
          policySweepOutcome: PolicySweepOutcome.Nudged,
          job,
          writes: [policyJobWrite(next)],
        });
      },
    );
    if (!committed.ok)
      return Result.ok(failed(repositoryFailure(committed.error)));
    const { policySweepOutcome, job } = committed.value;
    if (policySweepOutcome === PolicySweepOutcome.Started && job !== null) {
      ports.log(
        'warn',
        'policy recompute started by the sweep: a dropped start',
        {
          generation: job.generation,
          changedAtSeconds: job.changedAtSeconds,
          changedAtNanos: job.changedAtNanos,
          windowHours: job.windowHours,
        },
      );
    }
    if (policySweepOutcome === PolicySweepOutcome.Nudged && job !== null) {
      ports.log('info', 'policy recompute nudged', {
        generation: job.generation,
        cursor: job.cursor,
        lastFailureCode: job.lastFailureCode,
      });
    }
    return Result.ok({
      policySweepOutcome,
      attemptFailure: null,
      survivedFailure: null,
    });
  };
