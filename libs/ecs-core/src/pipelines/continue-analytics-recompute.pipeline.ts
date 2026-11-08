import { type BusyKey, LogEvent, Result } from '@core/primitives';
import {
  AttemptOutcome,
  PolicyStepOutcome,
  type WriteOp,
} from '@core/components';
import type { AnalyticsRecomputeJob } from '@core/entities';
import type {
  AnalyticsDayReadPorts,
  AnalyticsRecomputeJobPorts,
  LocationLoadPorts,
} from '@core/ports';
import {
  AnalyticsRecomputeJobSystem,
  type AttemptFailure,
  FailureCodeSystem,
  type RecomputeStep,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';
import {
  ANALYTICS_RECOMPUTE_JOB_PATH,
  analyticsJobWrite,
} from './start-analytics-recompute.pipeline';
import {
  AnalyticsDaySource,
  type WriteAnalyticsDayPorts,
  writeAnalyticsDay,
} from './write-analytics-day.pipeline';

/**
 * `continueAnalyticsRecompute` — one step of the analytics-days pass, fired
 * by each write of `backfillJobs/analyticsRecompute`
 * (`docs/designs/staff-analytics-v2.md`, «The recompute's job document»):
 * the next page of the pass's extent after its cursor
 * (`AnalyticsRecomputeJobSystem.nextPage`, `PAGE_SIZE` busy keys,
 * date-ascending then barber), its stored documents read by id
 * (`loadAnalyticsDaysByKeys`), the ELIGIBLE keys — missing, or computed
 * under another definition — handed to `writeAnalyticsDay` as a
 * `'RECOMPUTE'` command, then the cursor moved under a compare-and-set on
 * the step this delivery was fired for (`sameStep`): a duplicate delivery,
 * a stale one or a pass restarted by a later sweep writes nothing. The
 * advance is the write that fires the next step; the step that finds no
 * page left stamps `jobFinishedAtUtcMs` and logs `AnalyticsRecomputeDone`.
 *
 * A step whose writer met a TRANSIENT failure does not advance: it answers
 * the failure, the edge redelivers, and the same page runs again (every
 * day write is idempotent). Permanent failures are counted in `jobFailed`
 * and the page is finished; the first is logged as the step's survived
 * failure. A step that could not move the pass on a permanent failure
 * records the stall (`jobStalledAtUtcMs`, `jobLastFailureCode`), which the
 * 04:30 sweep nudges on.
 */

/** The job as the delivery's write left it — `null` when the document was deleted. */
export type ContinueAnalyticsRecomputeCommand = {
  readonly fired: AnalyticsRecomputeJob | null;
};

/** The step's answer — the vocabulary the policy step's uses, under the analytics' own field. */
export type AnalyticsStepReport = {
  readonly analyticsStepOutcome: PolicyStepOutcome;
  /** The failure this delivery answers with — the edge rethrows it when a redelivery can help. */
  readonly attemptFailure: AttemptFailure | null;
  /** A failure the step got past — logged by the edge, never rethrown. */
  readonly survivedFailure: AttemptFailure | null;
};

export type ContinueAnalyticsRecomputePorts = WriteAnalyticsDayPorts &
  AnalyticsDayReadPorts &
  AnalyticsRecomputeJobPorts &
  LocationLoadPorts;

const IDLE: AnalyticsStepReport = {
  analyticsStepOutcome: PolicyStepOutcome.Idle,
  attemptFailure: null,
  survivedFailure: null,
};

const SUPERSEDED: AnalyticsStepReport = {
  analyticsStepOutcome: PolicyStepOutcome.Superseded,
  attemptFailure: null,
  survivedFailure: null,
};

export const continueAnalyticsRecompute = (
  ports: ContinueAnalyticsRecomputePorts,
) => {
  /**
   * Best effort: say on the job that the pass is STALLED and why — a
   * compare-and-set on the fired step, so a pass that moved on is never
   * marked, and a stall already recorded with the same code is not
   * rewritten. Its own failure is logged, never answered.
   */
  async function recordStall(
    fired: AnalyticsRecomputeJob,
    failure: AttemptFailure,
  ): Promise<void> {
    const nowUtcMs = ports.nowUtcMs();
    try {
      const committed = await ports.commit(
        (tx) => tx.get<AnalyticsRecomputeJob>(ANALYTICS_RECOMPUTE_JOB_PATH),
        (live): Result<{ readonly writes: readonly WriteOp[] }, never> =>
          AnalyticsRecomputeJobSystem.shouldRecordStall(
            live,
            fired,
            failure.failureCode,
          ) && live !== null
            ? Result.ok({
                writes: [
                  analyticsJobWrite(
                    AnalyticsRecomputeJobSystem.stall(
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
        ports.log('warn', LogEvent.AnalyticsRecomputeStallNotRecorded, {
          job: fired.id,
          code: TriggerAttemptSystem.repositoryFailure(committed.error)
            .failureCode,
        });
      }
    } catch (error) {
      ports.log('warn', LogEvent.AnalyticsRecomputeStallNotRecorded, {
        job: fired.id,
        code: FailureCodeSystem.codeOf(error),
      });
    }
  }

  /** The step could not move the pass: a permanent failure is recorded on the job. */
  async function stalled(
    fired: AnalyticsRecomputeJob,
    failure: AttemptFailure,
    survivedFailure: AttemptFailure | null,
  ): Promise<AnalyticsStepReport> {
    if (failure.attemptOutcome === AttemptOutcome.Permanent) {
      await recordStall(fired, failure);
    }
    return {
      analyticsStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: failure,
      survivedFailure,
    };
  }

  /**
   * The job moved under the compare-and-set on the fired step: `move`
   * builds the next job from the one stored NOW, or nothing when the pass
   * is no longer at this step. Answers the job written, `null` when none.
   */
  async function moveJob(
    fired: AnalyticsRecomputeJob,
    move: (current: AnalyticsRecomputeJob) => AnalyticsRecomputeJob,
  ): Promise<Result<AnalyticsRecomputeJob | null, AttemptFailure>> {
    try {
      const committed = await ports.commit(
        (tx) => tx.get<AnalyticsRecomputeJob>(ANALYTICS_RECOMPUTE_JOB_PATH),
        (
          current,
        ): Result<
          {
            readonly next: AnalyticsRecomputeJob | null;
            readonly writes: readonly WriteOp[];
          },
          never
        > => {
          if (
            current === null ||
            !AnalyticsRecomputeJobSystem.sameStep(current, fired)
          ) {
            return Result.ok({ next: null, writes: [] });
          }
          const next = move(current);
          return Result.ok({ next, writes: [analyticsJobWrite(next)] });
        },
      );
      return committed.ok
        ? Result.ok(committed.value.next)
        : Result.err(TriggerAttemptSystem.repositoryFailure(committed.error));
    } catch (error) {
      return Result.err(TriggerAttemptSystem.attemptFailure(error));
    }
  }

  return async (
    cmd: ContinueAnalyticsRecomputeCommand,
  ): Promise<Result<AnalyticsStepReport, never>> => {
    const fired = cmd.fired;
    // No job, a finished pass, or the write that recorded a stall (the pass
    // rests until the sweep). The null test narrows; `isIdle` reads it too.
    if (fired === null || AnalyticsRecomputeJobSystem.isIdle(fired)) {
      return Result.ok(IDLE);
    }

    // The shop's day, on the default location's clock (F-4), read once.
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) {
      return Result.ok(
        await stalled(
          fired,
          TriggerAttemptSystem.repositoryFailure(zone.error),
          null,
        ),
      );
    }
    const today = ZonedTimeSystem.toLocal(
      ports.nowUtcMs(),
      zone.value,
    ).localDate;
    const extent = AnalyticsRecomputeJobSystem.extentOfPass(fired, today);
    const page = AnalyticsRecomputeJobSystem.nextPage(extent, fired.jobCursor);

    // The extent is exhausted: the pass finishes, under the same guard.
    if (page.length === 0) {
      const finished = await moveJob(fired, (current) =>
        AnalyticsRecomputeJobSystem.finish(current, ports.nowUtcMs()),
      );
      if (!finished.ok) {
        return Result.ok(await stalled(fired, finished.error, null));
      }
      if (finished.value === null) return Result.ok(SUPERSEDED);
      const done = finished.value;
      ports.log('info', LogEvent.AnalyticsRecomputeDone, {
        barbers: done.jobBarberIds.length,
        checked: done.jobChecked,
        written: done.jobWritten,
        failed: done.jobFailed,
        steps: done.jobSteps,
        fullReach: done.jobFullReach,
      });
      return Result.ok({
        analyticsStepOutcome: PolicyStepOutcome.Finished,
        attemptFailure: null,
        survivedFailure: null,
      });
    }

    // A duplicate or stale delivery stops before its page costs anything.
    const live = await ports.loadAnalyticsRecomputeJob();
    if (!live.ok) {
      return Result.ok(
        await stalled(
          fired,
          TriggerAttemptSystem.repositoryFailure(live.error),
          null,
        ),
      );
    }
    if (
      live.value === null ||
      !AnalyticsRecomputeJobSystem.sameStep(live.value, fired)
    ) {
      return Result.ok(SUPERSEDED);
    }

    // The page's documents by id; the eligible keys to the writer.
    const stored = await ports.loadAnalyticsDaysByKeys(page);
    if (!stored.ok) {
      return Result.ok(
        await stalled(
          fired,
          TriggerAttemptSystem.repositoryFailure(stored.error),
          null,
        ),
      );
    }
    const eligible: BusyKey[] = [];
    for (let i = 0; i < page.length; i++) {
      if (AnalyticsRecomputeJobSystem.isEligible(stored.value[i] ?? null)) {
        eligible.push(page[i] as BusyKey);
      }
    }
    const written = await writeAnalyticsDay(ports)({
      analyticsDaySource: AnalyticsDaySource.Recompute,
      keys: eligible,
    });
    if (!written.ok) {
      return Result.ok(
        await stalled(
          fired,
          TriggerAttemptSystem.repositoryFailure(written.error),
          null,
        ),
      );
    }
    const verdict = written.value.attemptFailure;
    if (verdict?.attemptOutcome === AttemptOutcome.Transient) {
      // Not advanced: the redelivery runs the same page again.
      return Result.ok(await stalled(fired, verdict, null));
    }
    const step: RecomputeStep = {
      cursor: page[page.length - 1] as BusyKey,
      checked: page.length,
      written: written.value.writtenKeys.length,
      failed: written.value.failedKeys.length,
    };
    const advanced = await moveJob(fired, (current) =>
      AnalyticsRecomputeJobSystem.advance(current, step, ports.nowUtcMs()),
    );
    if (!advanced.ok) {
      return Result.ok(await stalled(fired, advanced.error, verdict));
    }
    if (advanced.value === null) {
      return Result.ok({ ...SUPERSEDED, survivedFailure: verdict });
    }
    ports.log('info', LogEvent.AnalyticsRecomputeStep, {
      cursor: step.cursor,
      checked: step.checked,
      eligible: eligible.length,
      written: step.written,
      skipped: written.value.skippedKeys.length,
      kept: written.value.keptKeys.length,
      failed: step.failed,
      steps: advanced.value.jobSteps,
    });
    return Result.ok({
      analyticsStepOutcome: PolicyStepOutcome.Advanced,
      attemptFailure: null,
      survivedFailure: verdict,
    });
  };
};
