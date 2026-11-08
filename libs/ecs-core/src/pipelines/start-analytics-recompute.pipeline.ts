import { LogEvent, Result, type UtcEpochMs } from '@core/primitives';
import { PolicySweepOutcome, WriteOp } from '@core/components';
import {
  ANALYTICS_RECOMPUTE_DOC,
  type AnalyticsRecomputeJob,
  Collections,
} from '@core/entities';
import type {
  AnalyticsReadPorts,
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
} from '@core/ports';
import {
  AnalyticsRecomputeJobSystem,
  type AttemptFailure,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

/**
 * `startAnalyticsRecompute` — the 04:30 sweep's one write
 * (`docs/designs/staff-analytics-v2.md`, «The recompute's job document»):
 * no job, or a finished pass → a NEW pass over `extentOf`'s extent (the
 * full reach when the definition version or the sorted barber list
 * changed, else the window from the day before the last finished pass's
 * date to today — a missed night widens it by itself); a pass unfinished
 * and not moved for `STALE_AFTER_MS` → a NUDGE (a fresh `jobUpdatedAtUtcMs`,
 * the stall cleared, the cursor kept), whose write fires the next step; a
 * pass unfinished and fresh → nothing. It writes no day itself: ONE
 * transaction on `backfillJobs/analyticsRecompute`, whose write sets the
 * steps going (`continueAnalyticsRecompute`).
 *
 * "Today" and the day the last pass finished on are resolved ONCE here, on
 * the default shop's zone (Law 7.3, F-4); the job system stays zone-blind.
 * The barber list is every record (`listBarberRecordIds`), whatever its
 * status — a retired barber's history stays reportable.
 */

/** The sweep's answer — the vocabulary the policy sweep's uses, under the analytics' own field. */
export type AnalyticsSweepReport = {
  readonly analyticsSweepOutcome: PolicySweepOutcome;
  /** The failure the sweep answers with — the edge retries it when a redelivery can help. */
  readonly attemptFailure: AttemptFailure | null;
  readonly survivedFailure: AttemptFailure | null;
};

export type StartAnalyticsRecomputePorts = AnalyticsReadPorts &
  CommitPorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  ClockPorts &
  LogPorts;

/** `backfillJobs/analyticsRecompute` — the pass's one document. */
export const ANALYTICS_RECOMPUTE_JOB_PATH: readonly string[] = [
  Collections.BackfillJobs,
  ANALYTICS_RECOMPUTE_DOC,
];

/** A job's `Set` — the entity minus its id, at its own path. */
export function analyticsJobWrite(job: AnalyticsRecomputeJob): WriteOp {
  const { id, ...body } = job;
  return WriteOp.set([Collections.BackfillJobs, id], body);
}

function failed(failure: AttemptFailure): AnalyticsSweepReport {
  return {
    analyticsSweepOutcome: PolicySweepOutcome.Failed,
    attemptFailure: failure,
    survivedFailure: null,
  };
}

export const startAnalyticsRecompute =
  (ports: StartAnalyticsRecomputePorts) =>
  async (): Promise<Result<AnalyticsSweepReport, never>> => {
    // Outside the transaction: the shop's clock and the record list never
    // widen the job's conflict set.
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) {
      return Result.ok(
        failed(TriggerAttemptSystem.repositoryFailure(zone.error)),
      );
    }
    const records = await ports.listBarberRecordIds();
    if (!records.ok) {
      return Result.ok(
        failed(TriggerAttemptSystem.repositoryFailure(records.error)),
      );
    }
    const nowUtcMs = ports.nowUtcMs();
    const today = ZonedTimeSystem.toLocal(nowUtcMs, zone.value).localDate;
    const dayOf = (instant: UtcEpochMs) =>
      ZonedTimeSystem.toLocal(instant, zone.value).localDate;

    const committed = await ports.commit(
      (tx) => tx.get<AnalyticsRecomputeJob>(ANALYTICS_RECOMPUTE_JOB_PATH),
      (
        job,
      ): Result<
        {
          readonly analyticsSweepOutcome: PolicySweepOutcome;
          readonly next: AnalyticsRecomputeJob | null;
          readonly writes: readonly WriteOp[];
        },
        never
      > => {
        const extent = AnalyticsRecomputeJobSystem.extentOf(
          job,
          today,
          job === null || job.jobFinishedAtUtcMs === null
            ? null
            : dayOf(job.jobFinishedAtUtcMs),
          records.value,
        );
        const next = AnalyticsRecomputeJobSystem.sweep(job, extent, nowUtcMs);
        if (next === null) {
          return Result.ok({
            analyticsSweepOutcome: PolicySweepOutcome.Idle,
            next: null,
            writes: [],
          });
        }
        return Result.ok({
          analyticsSweepOutcome:
            job === null || job.jobFinishedAtUtcMs !== null
              ? PolicySweepOutcome.Started
              : PolicySweepOutcome.Nudged,
          next,
          writes: [analyticsJobWrite(next)],
        });
      },
    );
    if (!committed.ok) {
      return Result.ok(
        failed(TriggerAttemptSystem.repositoryFailure(committed.error)),
      );
    }
    const { analyticsSweepOutcome, next } = committed.value;
    if (next !== null) {
      ports.log('info', LogEvent.AnalyticsRecomputeSwept, {
        outcome: analyticsSweepOutcome,
        fullReach: next.jobFullReach,
        fromLocalDate: next.jobWindowFromLocalDate,
        toLocalDate: today,
        barbers: next.jobBarberIds.length,
        cursor: next.jobCursor,
        lastFailureCode: next.jobLastFailureCode,
      });
    }
    return Result.ok({
      analyticsSweepOutcome,
      attemptFailure: null,
      survivedFailure: null,
    });
  };
