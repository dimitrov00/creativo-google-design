import {
  type CustomerId,
  LogEvent,
  Result,
  type TimeZone,
} from '@core/primitives';
import {
  AttemptOutcome,
  ClientStatsPolicy,
  PolicyPass,
  PolicyStepOutcome,
  type WriteOp,
} from '@core/components';
import type { PolicyRecomputeJob } from '@core/entities';
import type {
  AdminBatchPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
  PolicyReadPorts,
} from '@core/ports';
import {
  type AttemptFailure,
  type PolicyStep,
  PolicyRecomputeJobSystem,
  TriggerAttemptSystem,
  WorkBudgetSystem,
} from '@core/systems';
import {
  type ClientStatsRecomputePorts,
  recomputeClients,
} from './project-client-stats.pipeline';
import { readShopZone } from './shop-zone-read.pipeline';
import {
  POLICY_RECOMPUTE_JOB_PATH,
  policyJobWrite,
} from './start-policy-recompute.pipeline';

/**
 * `continuePolicyRecompute` — one step of the policy pass, fired by each
 * write of `backfillJobs/clientStatsPolicy` (`recompute-on-policy-change.ts`,
 * blueprint §4.1): recompute the stored clients after the job's cursor, a
 * page at a time, for as long as the step's budget lasts — always the first
 * page, so a step never stands still — then move the cursor under a
 * compare-and-set on the step this delivery was fired for (`sameStep`): a
 * duplicate delivery, a stale one or a superseded pass writes nothing. The
 * advance is the write that fires the next step; the step that runs off the
 * end stamps `finishedAtUtcMs`, and the chain rests.
 *
 * Before EVERY page the job is read again: a newer change, or another
 * delivery's step, stops the walk there. Within a page a NEWER pass always
 * has the last word (each client's own transaction, `judgePolicyPass`). A
 * page with a TRANSIENT failure is not finished — its clients are retried by
 * the next step; one with only permanent failures is, its clients counted
 * and left to the backfill.
 *
 * The step answers what the edge does next (`attemptFailure` rethrown when a
 * redelivery can help, `survivedFailure` logged and never rethrown); a step
 * that could not move the pass on a PERMANENT failure records the stall on
 * the job (`stalledAtUtcMs`, `lastFailureCode`), which the daily sweep
 * nudges on.
 */

/** The job as the delivery's write left it — `null` when the document was deleted. */
export type ContinuePolicyRecomputeCommand = {
  readonly fired: PolicyRecomputeJob | null;
};

export type PolicyStepReport = {
  readonly policyStepOutcome: PolicyStepOutcome;
  /** The failure this delivery answers with — the edge rethrows it when a redelivery can help. */
  readonly attemptFailure: AttemptFailure | null;
  /** A failure the walk met but got past — logged by the edge, never rethrown. */
  readonly survivedFailure: AttemptFailure | null;
};

/** One step's time allowance, started by the edge as the step starts. */
export type StepBudget = { readonly spent: () => boolean };

export type ContinuePolicyRecomputePorts = ClientStatsRecomputePorts &
  PolicyReadPorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  AdminBatchPorts &
  LogPorts;

/** Stored clients per page. */
export const POLICY_PAGE_SIZE = 100;
/** Clients recomputed at once inside a page. */
export const POLICY_RECOMPUTE_WIDTH = 5;

/** What one step's walk got through, and what went wrong on the way. */
type Walk = {
  /** `null` when not one page was finished. */
  readonly step: PolicyStep | null;
  readonly failure: AttemptFailure | null;
  /** The job moved on without this step: it stopped before its next page. */
  readonly superseded: boolean;
};

const IDLE: PolicyStepReport = {
  policyStepOutcome: PolicyStepOutcome.Idle,
  attemptFailure: null,
  survivedFailure: null,
};

/**
 * `pageSize` is the stored clients one page reads ({@link POLICY_PAGE_SIZE});
 * a spec walks a small book a client at a time with `1`.
 */
export const continuePolicyRecompute = (
  ports: ContinuePolicyRecomputePorts,
  pageSize: number = POLICY_PAGE_SIZE,
) => {
  /**
   * The stored clients after the fired step's cursor, a page at a time until
   * the budget is spent, each recomputed under this pass's stamp against the
   * policy as it is NOW and on the default location's clock (each read once
   * per step, F-4). Never rejects: a read every client depends on that fails
   * ends the walk, and the pages before it count.
   */
  async function walkStoredClients(
    fired: PolicyRecomputeJob,
    budget: StepBudget,
  ): Promise<Walk> {
    const errors: unknown[] = [];
    const pass = PolicyPass.of(fired.generation, {
      seconds: fired.changedAtSeconds,
      nanos: fired.changedAtNanos,
    });
    let cursor: CustomerId | null = fired.cursor;
    let pages = 0;
    let visited = 0;
    let recomputed = 0;
    let failed = 0;
    let exhausted = false;
    let superseded = false;
    try {
      let policy: ClientStatsPolicy | null = null;
      let timeZone: TimeZone | null = null;
      while (WorkBudgetSystem.takesChunk(pages, () => budget.spent())) {
        const live = await ports.loadPolicyRecomputeJob();
        if (!live.ok) {
          errors.push(live.error);
          break;
        }
        if (
          live.value === null ||
          !PolicyRecomputeJobSystem.sameStep(live.value, fired)
        ) {
          superseded = true;
          break;
        }
        if (policy === null) {
          const loaded = await ports.loadPolicy();
          if (!loaded.ok) {
            errors.push(loaded.error);
            break;
          }
          policy = ClientStatsPolicy.forBooking(loaded.value);
        }
        if (timeZone === null) {
          const zone = await readShopZone(ports)(null);
          if (!zone.ok) {
            errors.push(zone.error);
            break;
          }
          timeZone = zone.value;
        }
        const page = await ports.pageClients(cursor, pageSize);
        if (!page.ok) {
          errors.push(page.error);
          break;
        }
        const ids = page.value;
        const report = await recomputeClients(
          ports,
          policy,
          ids,
          pass,
          POLICY_RECOMPUTE_WIDTH,
          timeZone,
        );
        errors.push(...report.failures);
        if (
          report.attemptFailure?.attemptOutcome === AttemptOutcome.Transient
        ) {
          break;
        }
        pages += 1;
        visited += ids.length;
        recomputed += report.written;
        failed += report.failures.length;
        cursor = ids[ids.length - 1] ?? cursor;
        if (ids.length < pageSize) {
          exhausted = true;
          break;
        }
      }
    } catch (error) {
      errors.push(error);
    }
    return {
      step:
        pages === 0 ? null : { cursor, exhausted, visited, recomputed, failed },
      failure: TriggerAttemptSystem.decisiveFailure(errors),
      superseded,
    };
  }

  /**
   * Best effort: say on the job that the pass is STALLED and why — a
   * compare-and-set on the fired step, so a pass that moved on is never
   * marked, and a stall already recorded with the same code is not
   * rewritten. Its own failure is logged, never answered.
   */
  async function recordStall(
    fired: PolicyRecomputeJob,
    failure: AttemptFailure,
  ): Promise<void> {
    const nowUtcMs = ports.nowUtcMs();
    try {
      const committed = await ports.commit(
        (tx) => tx.get<PolicyRecomputeJob>(POLICY_RECOMPUTE_JOB_PATH),
        (live): Result<{ readonly writes: readonly WriteOp[] }, never> =>
          live !== null &&
          PolicyRecomputeJobSystem.shouldRecordStall(
            live,
            fired,
            failure.failureCode,
          )
            ? Result.ok({
                writes: [
                  policyJobWrite(
                    PolicyRecomputeJobSystem.stall(
                      live,
                      failure.failureCode,
                      nowUtcMs,
                    ),
                  ),
                ],
              })
            : Result.ok({ writes: [] }),
      );
      if (!committed.ok) {
        ports.log('warn', LogEvent.PolicyRecomputeStallNotRecorded, {
          code: TriggerAttemptSystem.repositoryFailure(committed.error)
            .failureCode,
        });
      }
    } catch (error) {
      ports.log('warn', LogEvent.PolicyRecomputeStallNotRecorded, {
        code: TriggerAttemptSystem.failureCode(error),
      });
    }
  }

  /** The step could not move the pass: a permanent failure is recorded on the job. */
  async function stalled(
    fired: PolicyRecomputeJob,
    failure: AttemptFailure,
    survivedFailure: AttemptFailure | null,
  ): Promise<PolicyStepReport> {
    if (failure.attemptOutcome === AttemptOutcome.Permanent) {
      await recordStall(fired, failure);
    }
    return {
      policyStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: failure,
      survivedFailure,
    };
  }

  return async (
    cmd: ContinuePolicyRecomputeCommand,
    budget: StepBudget,
  ): Promise<Result<PolicyStepReport, never>> => {
    const fired = cmd.fired;
    // No job, a finished pass, or the write that recorded a stall (the pass
    // rests until the sweep). The null test narrows; `isIdle` reads it too.
    if (fired === null || PolicyRecomputeJobSystem.isIdle(fired)) {
      return Result.ok(IDLE);
    }

    const walk = await walkStoredClients(fired, budget);
    if (walk.step === null && !walk.superseded) {
      // Not one page finished, and the job is still this step's.
      const failure =
        walk.failure ??
        TriggerAttemptSystem.attemptFailure(
          null,
          TriggerAttemptSystem.UNKNOWN_CODE,
        );
      return Result.ok(await stalled(fired, failure, null));
    }
    // Finished pages advance the job, and that write carries the walk on
    // from the page that failed: logged, never rethrown.
    const survivedFailure = walk.failure;
    const step = walk.step;
    if (walk.superseded || step === null) {
      return Result.ok({
        policyStepOutcome: PolicyStepOutcome.Superseded,
        attemptFailure: null,
        survivedFailure,
      });
    }

    const nowUtcMs = ports.nowUtcMs();
    try {
      const advanced = await ports.commit(
        (tx) => tx.get<PolicyRecomputeJob>(POLICY_RECOMPUTE_JOB_PATH),
        (
          current,
        ): Result<
          {
            readonly next: PolicyRecomputeJob | null;
            readonly writes: readonly WriteOp[];
          },
          never
        > => {
          if (
            current === null ||
            !PolicyRecomputeJobSystem.sameStep(current, fired)
          ) {
            return Result.ok({ next: null, writes: [] });
          }
          const next = PolicyRecomputeJobSystem.advance(
            current,
            step,
            nowUtcMs,
          );
          return Result.ok({ next, writes: [policyJobWrite(next)] });
        },
      );
      if (!advanced.ok) {
        return Result.ok(
          await stalled(
            fired,
            TriggerAttemptSystem.repositoryFailure(advanced.error),
            survivedFailure,
          ),
        );
      }
      const next = advanced.value.next;
      return Result.ok({
        policyStepOutcome:
          next === null
            ? PolicyStepOutcome.Superseded
            : next.finishedAtUtcMs === null
              ? PolicyStepOutcome.Advanced
              : PolicyStepOutcome.Finished,
        attemptFailure: null,
        survivedFailure,
      });
    } catch (error) {
      return Result.ok(
        await stalled(
          fired,
          TriggerAttemptSystem.attemptFailure(error),
          survivedFailure,
        ),
      );
    }
  };
};
