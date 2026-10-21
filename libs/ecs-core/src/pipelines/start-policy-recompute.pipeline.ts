import { type RepositoryError, Result } from '@core/primitives';
import {
  type BookingPolicy,
  type PreciseInstant,
  WriteOp,
} from '@core/components';
import {
  BOOKING_POLICY_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
} from '@core/entities';
import type { ClockPorts, CommitPorts } from '@core/ports';
import { PolicyRecomputeJobSystem } from '@core/systems';

/**
 * `startPolicyRecompute` — a settings write that moved the late-cancel line
 * starts a pass over every stored client, or restarts the one running when
 * this change is newer (`recompute-on-policy-change.ts`, blueprint §4.1,
 * §9 D17). It recomputes nobody itself: ONE transaction on
 * `backfillJobs/clientStatsPolicy`, whose write sets the steps going
 * (`continuePolicyRecompute`).
 *
 * A cancellation is judged by the window stamped on it when it was made, so
 * only the free-cancellation window matters; every other policy field — the
 * horizon, the lead time, the party size — is nothing a client's stats read.
 * Idempotent under redelivery (the same event finds its own generation) and
 * under reordering (an older change never restarts a newer pass,
 * `PolicyRecomputeJobSystem.nextStep`). A failed transaction rejects: the
 * edge redelivers a transient failure and drops a permanent one, which the
 * daily sweep then catches up (`sweepPolicyRecompute`).
 */

/** One `settings/{docId}` write, decoded at the edge (policies through `BookingPolicy.withDefaults`). */
export type StartPolicyRecomputeCommand = {
  readonly settingsDocId: string;
  readonly before: BookingPolicy;
  readonly after: BookingPolicy;
  /** The write's event id — the pass's generation. */
  readonly generation: string;
  /** The write's time, at full precision (§9 D17). */
  readonly changedAt: PreciseInstant;
};

/** How a settings write left the recompute job — the ONLY source of these strings, the field `policyStartOutcome`. */
export const PolicyStartOutcome = {
  /** The write moved no late line: nothing to re-judge. */
  Unmoved: 'UNMOVED',
  /** A pass (re)started from the top. */
  Started: 'STARTED',
  /** This change's pass, or a newer one's, already owns the job. */
  Unchanged: 'UNCHANGED',
} as const;
export type PolicyStartOutcome =
  (typeof PolicyStartOutcome)[keyof typeof PolicyStartOutcome];

export type StartPolicyRecomputeAnswer = {
  readonly policyStartOutcome: PolicyStartOutcome;
};

export type StartPolicyRecomputePorts = CommitPorts & ClockPorts;

/** `backfillJobs/clientStatsPolicy` — the pass's one document. */
export const POLICY_RECOMPUTE_JOB_PATH: readonly string[] = [
  Collections.BackfillJobs,
  POLICY_RECOMPUTE_DOC,
];

/** A job's `Set` — the entity minus its id, at its own path (`backfillJobs/clientStatsPolicy`). */
export function policyJobWrite(job: PolicyRecomputeJob): WriteOp {
  const { id, ...body } = job;
  return WriteOp.set([Collections.BackfillJobs, id], body);
}

export const startPolicyRecompute =
  (ports: StartPolicyRecomputePorts) =>
  async (
    cmd: StartPolicyRecomputeCommand,
  ): Promise<Result<StartPolicyRecomputeAnswer, RepositoryError>> => {
    if (
      cmd.settingsDocId !== BOOKING_POLICY_DOC ||
      cmd.before.cancellationWindowHours === cmd.after.cancellationWindowHours
    ) {
      return Result.ok({ policyStartOutcome: PolicyStartOutcome.Unmoved });
    }
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => tx.get<PolicyRecomputeJob>(POLICY_RECOMPUTE_JOB_PATH),
      (
        current,
      ): Result<
        {
          readonly policyStartOutcome: PolicyStartOutcome;
          readonly writes: readonly WriteOp[];
        },
        never
      > => {
        const next = PolicyRecomputeJobSystem.nextStep(
          current,
          {
            generation: cmd.generation,
            changedAt: cmd.changedAt,
            // The line this pass draws, for the sweep to compare the live
            // policy with.
            windowHours: cmd.after.cancellationWindowHours,
          },
          nowUtcMs,
        );
        return next === null
          ? Result.ok({
              policyStartOutcome: PolicyStartOutcome.Unchanged,
              writes: [],
            })
          : Result.ok({
              policyStartOutcome: PolicyStartOutcome.Started,
              writes: [policyJobWrite(next)],
            });
      },
    );
    return committed.ok
      ? Result.ok({ policyStartOutcome: committed.value.policyStartOutcome })
      : committed;
  };
