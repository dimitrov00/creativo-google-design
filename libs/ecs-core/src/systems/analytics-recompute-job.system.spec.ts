import { describe, expect, it } from 'vitest';
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
  BarberAnalyticsDayId,
  BarberId,
  BusyKey,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import { deepFreeze, localDate, utcMs } from '@core/testing';
import { DayFigures } from '@core/components';
import {
  AnalyticsRecomputeJobSystem,
  type RecomputeExtent,
} from './analytics-recompute-job.system';

/*
 * The recompute's job (staff analytics v2, «The recompute's job document»):
 * the extent a pass walks, the pages a step takes, the compare-and-set
 * step key, the sweep's three verdicts, a recorded stall, and eligibility.
 */

const {
  PAGE_SIZE,
  STALE_AFTER_MS,
  advance,
  extentOf,
  extentOfPass,
  finish,
  isEligible,
  isIdle,
  nextPage,
  sameStep,
  shouldRecordStall,
  stall,
  start,
  stepKeyOf,
  sweep,
} = AnalyticsRecomputeJobSystem;

const ivan = BarberId.of('b-ivan');
const niko = BarberId.of('b-niko');
const maria = BarberId.of('b-maria');
/** The sweep's today: Sunday 8 November 2026. */
const TODAY = localDate('2026-11-08');
const T0 = utcMs('2026-11-08T02:30:00.000Z');
const t = (ms: number): UtcEpochMs => UtcEpochMs.plusMs(T0, ms);
const MINUTE = 60_000;

const fullExtent = (): RecomputeExtent =>
  extentOf(null, TODAY, null, [niko, ivan]);

/** A pass that finished on `finishedOn`, as the sweep reads it. */
function finished(
  finishedOn: string,
  overrides: Partial<AnalyticsRecomputeJob> = {},
): AnalyticsRecomputeJob {
  const job = start(fullExtent(), t(-3 * 86_400_000));
  return {
    ...finish(job, utcMs(`${finishedOn}T03:00:00.000Z`)),
    ...overrides,
  };
}

describe('AnalyticsRecomputeJobSystem.extentOf — what a pass walks', () => {
  it('no job: the full reach, from the first day a report may start, barbers sorted', () => {
    const extent = extentOf(null, TODAY, null, [niko, ivan]);
    expect(extent).toEqual({
      fromLocalDate: AnalyticsPeriod.earliestOn(TODAY),
      toLocalDate: TODAY,
      barberIds: [ivan, niko],
      fullReach: true,
    });
    expect(extent.fromLocalDate).toBe('2025-11-01');
  });

  it('a finished job of this definition and these barbers: the window from the day before it finished', () => {
    const job = finished('2026-11-07');
    const extent = extentOf(job, TODAY, localDate('2026-11-07'), [ivan, niko]);
    expect(extent).toEqual({
      fromLocalDate: localDate('2026-11-06'),
      toLocalDate: TODAY,
      barberIds: [ivan, niko],
      fullReach: false,
    });
    // An outage widens the window by itself.
    expect(
      extentOf(finished('2026-11-01'), TODAY, localDate('2026-11-01'), [
        ivan,
        niko,
      ]).fromLocalDate,
    ).toBe('2026-10-31');
  });

  it('a version change: the full reach', () => {
    const job = finished('2026-11-07', {
      jobDefinitionVersion: ANALYTICS_DEFINITION_VERSION - 1,
    });
    expect(
      extentOf(job, TODAY, localDate('2026-11-07'), [ivan, niko]).fullReach,
    ).toBe(true);
  });

  it('a barber-list change — a record added or gone — the full reach; the same list in another order is the same list', () => {
    const job = finished('2026-11-07');
    expect(
      extentOf(job, TODAY, localDate('2026-11-07'), [ivan, niko, maria])
        .fullReach,
    ).toBe(true);
    expect(
      extentOf(job, TODAY, localDate('2026-11-07'), [ivan]).fullReach,
    ).toBe(true);
    expect(
      extentOf(job, TODAY, localDate('2026-11-07'), [niko, ivan]).fullReach,
    ).toBe(false);
  });

  it('a job that never finished has no date to window from: the full reach', () => {
    const job = start(fullExtent(), T0);
    expect(extentOf(job, TODAY, null, [ivan, niko]).fullReach).toBe(true);
  });

  it('extentOfPass: a running pass walks its stored window up to the step’s today', () => {
    const job = start(
      {
        ...fullExtent(),
        fromLocalDate: localDate('2026-11-06'),
        fullReach: false,
      },
      T0,
    );
    expect(extentOfPass(job, localDate('2026-11-09'))).toEqual({
      fromLocalDate: '2026-11-06',
      toLocalDate: '2026-11-09',
      barberIds: [ivan, niko],
      fullReach: false,
    });
  });
});

describe('AnalyticsRecomputeJobSystem.nextPage — date-ascending, then barber order', () => {
  const extent: RecomputeExtent = {
    fromLocalDate: localDate('2026-11-01'),
    toLocalDate: localDate('2026-11-03'),
    barberIds: [ivan, niko],
    fullReach: false,
  };
  const key = (barber: BarberId, day: string) =>
    BusyKey.of(barber, localDate(day));

  it('enumerates every barber of a day before the next day, from the top', () => {
    expect(nextPage(extent, null)).toEqual([
      key(ivan, '2026-11-01'),
      key(niko, '2026-11-01'),
      key(ivan, '2026-11-02'),
      key(niko, '2026-11-02'),
      key(ivan, '2026-11-03'),
      key(niko, '2026-11-03'),
    ]);
  });

  it('resumes after the cursor and answers no key past the end', () => {
    expect(nextPage(extent, key(niko, '2026-11-02'))).toEqual([
      key(ivan, '2026-11-03'),
      key(niko, '2026-11-03'),
    ]);
    expect(nextPage(extent, key(niko, '2026-11-03'))).toEqual([]);
  });

  it('takes PAGE_SIZE keys at most', () => {
    const wide: RecomputeExtent = {
      ...extent,
      toLocalDate: LocalDate.addDays(extent.fromLocalDate, 365),
    };
    const first = nextPage(wide, null);
    expect(PAGE_SIZE).toBe(100);
    expect(first).toHaveLength(PAGE_SIZE);
    const second = nextPage(wide, first[first.length - 1] as BusyKey);
    expect(second[0]).toBe(key(ivan, '2026-12-21'));
    expect(new Set([...first, ...second]).size).toBe(200);
  });

  it('a cursor before the extent restarts it; a barber not listed sits before the day’s first key; no barber, no key', () => {
    expect(nextPage(extent, key(ivan, '2026-10-20'))).toEqual(
      nextPage(extent, null),
    );
    expect(nextPage(extent, key(maria, '2026-11-02'))).toEqual([
      key(ivan, '2026-11-02'),
      key(niko, '2026-11-02'),
      key(ivan, '2026-11-03'),
      key(niko, '2026-11-03'),
    ]);
    expect(nextPage({ ...extent, barberIds: [] }, null)).toEqual([]);
    expect(
      nextPage({ ...extent, toLocalDate: localDate('2026-10-31') }, null),
    ).toEqual([]);
  });
});

describe('AnalyticsRecomputeJobSystem — the sweep’s verdicts and the steps', () => {
  it('no job: a new pass over the extent, at the top, under its fixed id and tag', () => {
    const job = sweep(null, fullExtent(), T0) as AnalyticsRecomputeJob;
    expect(job).toEqual({
      id: AnalyticsRecomputeJobId.FIXED,
      recomputeJobName: RecomputeJobName.AnalyticsDays,
      jobDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      jobBarberIds: [ivan, niko],
      jobWindowFromLocalDate: '2025-11-01',
      jobCursor: null,
      jobFullReach: true,
      jobStartedAtUtcMs: T0,
      jobUpdatedAtUtcMs: T0,
      jobFinishedAtUtcMs: null,
      jobStepKey: stepKeyOf(T0, null, null),
      jobStalledAtUtcMs: null,
      jobLastFailureCode: null,
      jobChecked: 0,
      jobWritten: 0,
      jobFailed: 0,
      jobSteps: 0,
    });
    expect(job.id).toBe('analyticsRecompute');
    expect(isIdle(job)).toBe(false);
  });

  it('a finished job: a new pass', () => {
    const job = sweep(finished('2026-11-07'), fullExtent(), T0);
    expect(job?.jobFinishedAtUtcMs).toBeNull();
    expect(job?.jobStartedAtUtcMs).toBe(T0);
    expect(job?.jobCursor).toBeNull();
  });

  it('a stale unfinished job: a nudge — updated now, the stall cleared, the cursor and the step kept', () => {
    const running = stall(
      advance(
        start(fullExtent(), t(-20 * MINUTE)),
        {
          cursor: BusyKey.of(ivan, localDate('2025-11-01')),
          checked: 2,
          written: 1,
          failed: 0,
        },
        t(-16 * MINUTE),
      ),
      'unavailable',
      t(-15 * MINUTE),
    );
    expect(STALE_AFTER_MS).toBe(15 * MINUTE);
    const nudged = sweep(running, fullExtent(), T0) as AnalyticsRecomputeJob;
    expect(nudged.jobUpdatedAtUtcMs).toBe(T0);
    expect(nudged.jobStalledAtUtcMs).toBeNull();
    expect(nudged.jobCursor).toBe(running.jobCursor);
    expect(nudged.jobChecked).toBe(2);
    expect(sameStep(nudged, running)).toBe(true);
  });

  it('a fresh unfinished job: no write', () => {
    const running = start(fullExtent(), t(-14 * MINUTE));
    expect(sweep(running, fullExtent(), T0)).toBeNull();
    expect(sweep(running, fullExtent(), t(1 * MINUTE))).not.toBeNull();
  });

  it('advance moves the cursor, adds the counts and a step, and ends a stall; finish stamps the end', () => {
    const job = start(fullExtent(), T0);
    const cursor = BusyKey.of(niko, localDate('2025-11-01'));
    const stepped = advance(
      stall(job, 'deadline-exceeded', t(MINUTE)),
      { cursor, checked: 100, written: 7, failed: 1 },
      t(2 * MINUTE),
    );
    expect(stepped).toEqual({
      ...job,
      jobCursor: cursor,
      jobChecked: 100,
      jobWritten: 7,
      jobFailed: 1,
      jobSteps: 1,
      jobUpdatedAtUtcMs: t(2 * MINUTE),
      jobStepKey: stepKeyOf(T0, cursor, null),
    });
    expect(sameStep(stepped, job)).toBe(false);
    const done = finish(stepped, t(3 * MINUTE));
    expect(done.jobFinishedAtUtcMs).toBe(t(3 * MINUTE));
    expect(done.jobStepKey).toBe(stepKeyOf(T0, cursor, t(3 * MINUTE)));
    expect(isIdle(done)).toBe(true);
    expect(isIdle(null)).toBe(true);
    expect(isIdle(stall(stepped, 'x', t(4 * MINUTE)))).toBe(true);
  });

  it('stepKeyOf / sameStep: the pass, the cursor and the finish — a later pass at the same cursor is another step', () => {
    const cursor = BusyKey.of(ivan, localDate('2025-11-02'));
    const a = advance(
      start(fullExtent(), T0),
      { cursor, checked: 1, written: 0, failed: 0 },
      t(MINUTE),
    );
    const b = advance(
      start(fullExtent(), t(MINUTE)),
      { cursor, checked: 1, written: 0, failed: 0 },
      t(2 * MINUTE),
    );
    expect(sameStep(a, b)).toBe(false);
    expect(stepKeyOf(T0, cursor, null)).toBe(
      JSON.stringify(['analytics-step/v1', T0, cursor, null]),
    );
  });

  it('records a stall once, on the fired step only, and keeps the moved-at instant', () => {
    const job = start(fullExtent(), T0);
    expect(shouldRecordStall(job, job, 'unavailable')).toBe(true);
    const stalled = stall(job, 'unavailable', t(MINUTE));
    expect(stalled.jobUpdatedAtUtcMs).toBe(T0);
    expect(stalled.jobLastFailureCode).toBe('unavailable');
    expect(shouldRecordStall(stalled, job, 'unavailable')).toBe(false);
    expect(shouldRecordStall(stalled, job, 'internal')).toBe(true);
    expect(shouldRecordStall(null, job, 'unavailable')).toBe(false);
    const moved = advance(
      job,
      {
        cursor: BusyKey.of(ivan, localDate('2025-11-01')),
        checked: 1,
        written: 1,
        failed: 0,
      },
      t(MINUTE),
    );
    expect(shouldRecordStall(moved, job, 'unavailable')).toBe(false);
  });

  it('isEligible: a missing day, or one of another definition — not one of this', () => {
    const stored = (version: number): BarberAnalyticsDay => ({
      id: BarberAnalyticsDayId.of(BusyKey.of(ivan, localDate('2026-11-01'))),
      ...DayFigures.empty(ivan, localDate('2026-11-01'), T0),
      dayDefinitionVersion: version,
    });
    expect(isEligible(null)).toBe(true);
    expect(isEligible(stored(ANALYTICS_DEFINITION_VERSION - 1))).toBe(true);
    expect(isEligible(stored(ANALYTICS_DEFINITION_VERSION + 1))).toBe(true);
    expect(isEligible(stored(ANALYTICS_DEFINITION_VERSION))).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const job = deepFreeze(finished('2026-11-07'));
    const extent = deepFreeze(fullExtent());
    expect(extentOf(job, TODAY, localDate('2026-11-07'), [ivan, niko])).toEqual(
      extentOf(job, TODAY, localDate('2026-11-07'), [ivan, niko]),
    );
    expect(nextPage(extent, null)).toEqual(nextPage(extent, null));
    expect(sweep(job, extent, T0)).toEqual(sweep(job, extent, T0));
    expect(job.jobFinishedAtUtcMs).not.toBeNull();
  });
});
