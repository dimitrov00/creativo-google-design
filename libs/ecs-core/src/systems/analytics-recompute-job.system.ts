import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsPeriod,
} from '@core/components';
import {
  type AnalyticsRecomputeJob,
  type BarberAnalyticsDay,
  RecomputeJobName,
} from '@core/entities';
import {
  AnalyticsRecomputeJobId,
  type BarberId,
  BusyKey,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';

/**
 * THE ANALYTICS-DAYS RECOMPUTE'S JOB, as decisions
 * (`docs/designs/staff-analytics-v2.md`, «The recompute's job document»):
 * what extent a pass walks, which page a step takes, how a step advances the
 * job under its compare-and-set key, when a stalled pass is nudged, and
 * which stored day is eligible for a rewrite. The pipelines
 * (`startAnalyticsRecompute`, `continueAnalyticsRecompute`) read and write;
 * this system only decides.
 *
 * Built on the policy job's model (`policy-recompute-job.system.ts`): a
 * step key over the fields a step moves, `sameStep` as the guard that gives
 * the chain exactly one continuation, a stall recorded once, a sweep that
 * nudges a pass that stopped moving. Those members are typed against the
 * policy job's own fields (`generation`, `cursor`, `stepKey`), so this job
 * — a window and a cursor of busy keys, no generation — declares its own.
 *
 * Every instant is a lifecycle stamp (`*UtcMs`); staleness is elapsed real
 * time through `UtcEpochMs` (flatten-spec T2). The one zone-resolved value
 * — the day the last pass finished on — arrives as a `LocalDate` the
 * pipeline derived once (Law 7.3); the system stays zone-blind.
 */

/** Busy keys a step handles — the Admin SDK's `getAll` reads one page by id. */
const PAGE_SIZE = 100;

/** How long a pass may go without moving before the sweep nudges it. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** The step key's spelling, versioned beside the policy job's. */
const STEP_KEY_TAG = 'analytics-step/v1';

/**
 * The barber-days a pass walks: every `barberIds` × every day of
 * `[fromLocalDate, toLocalDate]`, keys enumerated date-ascending then
 * barber in `barberIds` order (the sorted record list).
 */
export type RecomputeExtent = {
  readonly fromLocalDate: LocalDate;
  readonly toLocalDate: LocalDate;
  readonly barberIds: readonly BarberId[];
  /** The whole reach, not the window since the last finished pass. */
  readonly fullReach: boolean;
};

/** What one step of the walk got through. */
export type RecomputeStep = {
  /** The last key handled — the cursor the next page starts after. */
  readonly cursor: BusyKey;
  /** Keys whose document was read. */
  readonly checked: number;
  /** Eligible days written. */
  readonly written: number;
  /** Eligible days the writer could not write. */
  readonly failed: number;
};

/** `a` and `b` are the same list in the same order. */
function sameList(a: readonly BarberId[], b: readonly BarberId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The job with its step key re-derived from the fields the key covers. */
function keyed(job: AnalyticsRecomputeJob): AnalyticsRecomputeJob {
  return {
    ...job,
    jobStepKey: AnalyticsRecomputeJobSystem.stepKeyOf(
      job.jobStartedAtUtcMs,
      job.jobCursor,
      job.jobFinishedAtUtcMs,
    ),
  };
}

export const AnalyticsRecomputeJobSystem = {
  PAGE_SIZE,
  STALE_AFTER_MS,

  /**
   * The extent the next pass walks, on `today` (the default shop's day),
   * for the sorted record list `barberIds`: the FULL reach — from
   * `AnalyticsPeriod.earliestOn(today)`, the first day a report may start
   * — when there is no job, when the job's definition version is not this
   * one, or when its sorted barber list is not `barberIds`; else the window
   * from the day before the last finished pass's date (`finishedOnLocalDate`,
   * resolved by the pipeline on the default shop's zone) to today — an
   * outage widens it by itself. A job that never finished has no date to
   * window from and walks the full reach too.
   */
  extentOf(
    job: AnalyticsRecomputeJob | null,
    today: LocalDate,
    finishedOnLocalDate: LocalDate | null,
    barberIds: readonly BarberId[],
  ): RecomputeExtent {
    const sorted = [...barberIds].sort();
    const full =
      job === null ||
      finishedOnLocalDate === null ||
      job.jobDefinitionVersion !== ANALYTICS_DEFINITION_VERSION ||
      !sameList(job.jobBarberIds, sorted);
    return {
      fromLocalDate: full
        ? AnalyticsPeriod.earliestOn(today)
        : LocalDate.addDays(finishedOnLocalDate, -1),
      toLocalDate: today,
      barberIds: sorted,
      fullReach: full,
    };
  },

  /** The extent a RUNNING pass walks at a step on `today`: its stored window, up to today. */
  extentOfPass(job: AnalyticsRecomputeJob, today: LocalDate): RecomputeExtent {
    return {
      fromLocalDate: job.jobWindowFromLocalDate,
      toLocalDate: LocalDate.later(job.jobWindowFromLocalDate, today),
      barberIds: job.jobBarberIds,
      fullReach: job.jobFullReach,
    };
  },

  /**
   * The next page of `extent`'s keys after `cursor` (`null` at the top):
   * up to {@link PAGE_SIZE} busy keys, date-ascending then barber order.
   * A cursor outside the extent — a day before it, a barber not listed —
   * resumes from the key after its position; one past the end answers no
   * key. Empty when the extent lists no barber.
   */
  nextPage(
    extent: RecomputeExtent,
    cursor: BusyKey | null,
  ): readonly BusyKey[] {
    const barbers = extent.barberIds;
    const width = barbers.length;
    if (width === 0) return [];
    const days =
      LocalDate.daysBetween(extent.fromLocalDate, extent.toLocalDate) + 1;
    if (days <= 0) return [];
    const total = days * width;
    let start = 0;
    if (cursor !== null) {
      const parts = BusyKey.split(cursor);
      const dayIndex = LocalDate.daysBetween(
        extent.fromLocalDate,
        parts.localDate,
      );
      const barberIndex = barbers.indexOf(parts.barberId);
      if (dayIndex >= 0) {
        // A barber not in the list sits before the day's first key.
        start = dayIndex * width + barberIndex + 1;
      }
    }
    const out: BusyKey[] = [];
    for (let i = start; i < total && out.length < PAGE_SIZE; i++) {
      const day = LocalDate.addDays(
        extent.fromLocalDate,
        Math.floor(i / width),
      );
      out.push(BusyKey.of(barbers[i % width] as BarberId, day));
    }
    return out;
  },

  /**
   * Is a stored day ELIGIBLE for a rewrite: missing, or computed under
   * another definition than this one (a newer one too — code rolled back
   * must not serve figures of a definition it does not know).
   */
  isEligible(stored: BarberAnalyticsDay | null): boolean {
    return (
      stored === null ||
      stored.dayDefinitionVersion !== ANALYTICS_DEFINITION_VERSION
    );
  },

  /**
   * The compare-and-set key of a step: the pass (its start instant), where
   * it stands and whether it finished — what `sameStep` compares, as one
   * stored string.
   */
  stepKeyOf(
    startedAtUtcMs: UtcEpochMs,
    cursor: BusyKey | null,
    finishedAtUtcMs: UtcEpochMs | null,
  ): string {
    return JSON.stringify([
      STEP_KEY_TAG,
      startedAtUtcMs,
      cursor,
      finishedAtUtcMs,
    ]);
  },

  /**
   * Is the job still at the step a delivery was fired for? A redelivered
   * or duplicated event, a step overtaken by another, or a pass restarted
   * by a later sweep all fail it and write nothing — so the chain has
   * exactly one continuation.
   */
  sameStep(a: AnalyticsRecomputeJob, b: AnalyticsRecomputeJob): boolean {
    return (
      a.jobStartedAtUtcMs === b.jobStartedAtUtcMs &&
      a.jobCursor === b.jobCursor &&
      Object.is(a.jobFinishedAtUtcMs, b.jobFinishedAtUtcMs)
    );
  },

  /** A new pass over `extent`, at the top, stamped `nowUtcMs` — the write that fires the first step. */
  start(extent: RecomputeExtent, nowUtcMs: UtcEpochMs): AnalyticsRecomputeJob {
    return keyed({
      id: AnalyticsRecomputeJobId.FIXED,
      recomputeJobName: RecomputeJobName.AnalyticsDays,
      jobDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      jobBarberIds: extent.barberIds,
      jobWindowFromLocalDate: extent.fromLocalDate,
      jobCursor: null,
      jobFullReach: extent.fullReach,
      jobStartedAtUtcMs: nowUtcMs,
      jobUpdatedAtUtcMs: nowUtcMs,
      jobFinishedAtUtcMs: null,
      jobStepKey: '',
      jobStalledAtUtcMs: null,
      jobLastFailureCode: null,
      jobChecked: 0,
      jobWritten: 0,
      jobFailed: 0,
      jobSteps: 0,
    });
  },

  /**
   * The sweep's verdict: the job to write, or `null` to leave it. No job,
   * or a finished pass → a new pass over `extent` ({@link start}); an
   * unfinished pass that has not moved for `staleAfterMs` → a nudge (a
   * fresh `jobUpdatedAtUtcMs`, the stall cleared, the cursor kept — the
   * same step, so it meets the same compare-and-set as any delivery); an
   * unfinished pass still moving → nothing.
   */
  sweep(
    job: AnalyticsRecomputeJob | null,
    extent: RecomputeExtent,
    nowUtcMs: UtcEpochMs,
    staleAfterMs: number = STALE_AFTER_MS,
  ): AnalyticsRecomputeJob | null {
    if (job === null || job.jobFinishedAtUtcMs !== null) {
      return AnalyticsRecomputeJobSystem.start(extent, nowUtcMs);
    }
    const staleFrom = UtcEpochMs.plusMs(job.jobUpdatedAtUtcMs, staleAfterMs);
    if (UtcEpochMs.compare(nowUtcMs, staleFrom) < 0) return null;
    return { ...job, jobUpdatedAtUtcMs: nowUtcMs, jobStalledAtUtcMs: null };
  },

  /**
   * Does a delivery of the job's write leave the pass alone? No job (the
   * document was deleted), a finished pass, or a stalled one — the write
   * that RECORDED the stall fires a delivery too, and the pass rests on it
   * until the sweep nudges it.
   */
  isIdle(fired: AnalyticsRecomputeJob | null): boolean {
    return (
      fired === null ||
      fired.jobFinishedAtUtcMs !== null ||
      fired.jobStalledAtUtcMs !== null
    );
  },

  /**
   * The job after one page: the cursor on the page's last key, the counts
   * added, one more step, `jobUpdatedAtUtcMs` moved, any stall before it
   * ended. Every advance moves the cursor, so each is a real change — the
   * write that fires the next step — and the chain cannot spin in place.
   */
  advance(
    job: AnalyticsRecomputeJob,
    step: RecomputeStep,
    nowUtcMs: UtcEpochMs,
  ): AnalyticsRecomputeJob {
    return keyed({
      ...job,
      jobCursor: step.cursor,
      jobChecked: job.jobChecked + step.checked,
      jobWritten: job.jobWritten + step.written,
      jobFailed: job.jobFailed + step.failed,
      jobSteps: job.jobSteps + 1,
      jobUpdatedAtUtcMs: nowUtcMs,
      jobStalledAtUtcMs: null,
      jobLastFailureCode: null,
    });
  },

  /**
   * The job when the extent is exhausted (`nextPage` answered no key):
   * `jobFinishedAtUtcMs` stamped — the version and the barber list it
   * recorded at the start are what the next sweep's `extentOf` compares.
   */
  finish(
    job: AnalyticsRecomputeJob,
    nowUtcMs: UtcEpochMs,
  ): AnalyticsRecomputeJob {
    return keyed({
      ...job,
      jobUpdatedAtUtcMs: nowUtcMs,
      jobFinishedAtUtcMs: nowUtcMs,
      jobStalledAtUtcMs: null,
      jobLastFailureCode: null,
    });
  },

  /**
   * Is a permanent stall worth recording on the job as it stands now
   * (`live`)? Only on the step the delivery was fired for (`sameStep`) —
   * a pass that moved on, or a deleted job, is never marked — and not when
   * the same stall, by the same `failureCode`, is already recorded.
   */
  shouldRecordStall(
    live: AnalyticsRecomputeJob | null,
    fired: AnalyticsRecomputeJob,
    failureCode: string,
  ): boolean {
    if (live === null || !AnalyticsRecomputeJobSystem.sameStep(live, fired)) {
      return false;
    }
    return !(
      live.jobStalledAtUtcMs !== null && live.jobLastFailureCode === failureCode
    );
  },

  /**
   * The job with the record of a permanent stall. The cursor, the counts
   * and `jobUpdatedAtUtcMs` stay — the last still says when the pass last
   * MOVED, what the sweep measures staleness by. Still the same step.
   */
  stall(
    job: AnalyticsRecomputeJob,
    failureCode: string,
    nowUtcMs: UtcEpochMs,
  ): AnalyticsRecomputeJob {
    return {
      ...job,
      jobStalledAtUtcMs: nowUtcMs,
      jobLastFailureCode: failureCode,
    };
  },
} as const;
