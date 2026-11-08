import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_DEFINITION_VERSION,
  AttemptOutcome,
  BookingPolicy,
  PolicyStepOutcome,
} from '@core/components';
import { BusyKey, Result, UtcEpochMs as Instant } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type AnalyticsRecomputeJob,
  type Appointment,
  type BarberAnalyticsDay,
  type BarberSchedule,
  Collections,
  type ScheduleException,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { AnalyticsRecomputeJobSystem } from '@core/systems';
import {
  ANALYTICS_FIXTURE_BARBERS,
  ANALYTICS_FIXTURE_DEPARTURES,
  ANALYTICS_FIXTURE_LOCATIONS,
  ANALYTICS_FIXTURE_ROSTERS,
  ANALYTICS_FIXTURE_SHOPS,
  ANALYTICS_FIXTURE_VISITS,
  analyticsFixtureDayDocuments,
  bodyOf,
  FIXTURE_NOW_UTC_MS,
  localDate,
  memoryAnalyticsDayPorts,
  memoryAnalyticsReadPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
} from '@core/testing';
import { continueAnalyticsRecompute } from './continue-analytics-recompute.pipeline';
import { ANALYTICS_RECOMPUTE_JOB_PATH } from './start-analytics-recompute.pipeline';
import { analyticsDayPath } from './write-analytics-day.pipeline';

/*
 * One step of the analytics-days pass (staff analytics v2, «The recompute's
 * job document»), over the fixture month at the pinned now (Monday the
 * 28th, 09:00 in Sofia): the page after the cursor, its documents read by
 * key, only the eligible handed to the writer, the advance under the
 * compare-and-set, the finish, and what a failure does.
 */

const { ivan, maria, niko } = ANALYTICS_FIXTURE_BARBERS;
const { centre } = ANALYTICS_FIXTURE_SHOPS;
const NOW = FIXTURE_NOW_UTC_MS;
const MINUTE = 60_000;

const key = (barber: typeof ivan, day: string): BusyKey =>
  BusyKey.of(barber, localDate(day));

/** A running pass over Ivan and Maria from the 24th, at `cursor`. */
function passAt(
  cursor: BusyKey | null,
  from = '2026-09-24',
): AnalyticsRecomputeJob {
  const started = AnalyticsRecomputeJobSystem.start(
    {
      fromLocalDate: localDate(from),
      toLocalDate: localDate('2026-09-28'),
      barberIds: [ivan, maria],
      fullReach: false,
    },
    Instant.plusMs(NOW, -10 * MINUTE),
  );
  return cursor === null
    ? started
    : AnalyticsRecomputeJobSystem.advance(
        started,
        { cursor, checked: 2, written: 2, failed: 0 },
        Instant.plusMs(NOW, -5 * MINUTE),
      );
}

/** The fixture's day document for `key`. */
function fixtureDay(at: BusyKey): BarberAnalyticsDay {
  const doc = analyticsFixtureDayDocuments().find(
    (day) => String(day.id) === at,
  );
  if (doc === undefined) throw new Error(`no fixture day ${at}`);
  return doc;
}

type World = {
  readonly job: AnalyticsRecomputeJob | null;
  readonly days?: readonly BarberAnalyticsDay[];
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(world: World) {
  const store = memoryStore([
    ...ANALYTICS_FIXTURE_VISITS.map((visit) => ({
      path: [Collections.Appointments, visit.id],
      body: bodyOf(visit),
    })),
    ...ANALYTICS_FIXTURE_ROSTERS.map((roster) => ({
      path: [Collections.BarberSchedules, roster.id],
      body: bodyOf(roster),
    })),
    ...ANALYTICS_FIXTURE_DEPARTURES.map((exception) => ({
      path: [Collections.ScheduleExceptions, exception.id],
      body: bodyOf(exception),
    })),
    ...(world.days ?? []).map((day) => ({
      path: [Collections.AnalyticsDays, day.id],
      body: bodyOf(day),
    })),
    ...(world.job === null
      ? []
      : [{ path: ANALYTICS_RECOMPUTE_JOB_PATH, body: bodyOf(world.job) }]),
  ]);
  const tx = memoryTxPorts(store, { nowUtcMs: () => NOW });
  const telemetry = recordingTelemetry();
  const at = <E>(path: readonly string[]): E | null => {
    const body = store.get(path.join('/'));
    return body === undefined
      ? null
      : ({ id: path[path.length - 1], ...body } as E);
  };
  const jobOf = (): AnalyticsRecomputeJob | null =>
    at<AnalyticsRecomputeJob>(ANALYTICS_RECOMPUTE_JOB_PATH);
  const analytics = memoryAnalyticsReadPorts({
    visits: ANALYTICS_FIXTURE_VISITS,
    departures: ANALYTICS_FIXTURE_DEPARTURES,
    barberIds: [ivan, maria, niko],
    locations: ANALYTICS_FIXTURE_LOCATIONS,
  });
  // The day reads answer the STORE (what the writer wrote), the job too.
  const dayPorts = memoryAnalyticsDayPorts({ days: world.days ?? [] });
  const ports = {
    ...tx,
    commit: world.commit === undefined ? tx.commit : world.commit(tx.commit),
    ...telemetry,
    ...analytics.ports,
    ...dayPorts.ports,
    loadAnalyticsDaysByKeys: async (keys: readonly BusyKey[]) => {
      const logged = await dayPorts.ports.loadAnalyticsDaysByKeys(keys);
      if (!logged.ok) return logged;
      return Result.ok(
        keys.map((k) => at<BarberAnalyticsDay>(analyticsDayPath(k))),
      );
    },
    loadAnalyticsRecomputeJob: async () => Result.ok(jobOf()),
    loadSchedule: async (barberId: string) =>
      Result.ok(at<BarberSchedule>([Collections.BarberSchedules, barberId])),
    loadScheduleException: async (k: string) =>
      Result.ok(at<ScheduleException>([Collections.ScheduleExceptions, k])),
    loadBusyDay: async () => Result.ok(null),
    loadAppointment: async (id: string) =>
      Result.ok(at<Appointment>([Collections.Appointments, id])),
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    ...memoryLocationLoadPorts(
      memoryProgramsWorld({ locations: ANALYTICS_FIXTURE_LOCATIONS }),
    ),
    ...memoryDefaultLocationPorts(centre),
  };
  const dayKeysWritten = (): readonly string[] =>
    tx.plans
      .flat()
      .filter((op) => op.path[0] === Collections.AnalyticsDays)
      .map((op) => op.path[1] as string);
  return {
    store,
    tx,
    telemetry,
    ports,
    jobOf,
    dayReads: dayPorts.log,
    dayKeysWritten,
    step: continueAnalyticsRecompute(ports),
  };
}

const quiet = { attemptFailure: null, survivedFailure: null } as const;
describe('continueAnalyticsRecompute — the page after the cursor', () => {
  it('resumes from the cursor: the page’s documents read by key, ONLY the eligible handed to the writer, the past ones written, the cursor moved', async () => {
    const fired = passAt(key(ivan, '2026-09-25'));
    const current = fixtureDay(key(maria, '2026-09-25'));
    const stale: BarberAnalyticsDay = {
      ...fixtureDay(key(ivan, '2026-09-26')),
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION - 1,
      dayComputedAtUtcMs: Instant.plusMs(NOW, -MINUTE),
    };
    const world = rig({ job: fired, days: [current, stale] });
    const report = await world.step({ fired });
    expect(report).toEqual({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Advanced, ...quiet },
    });
    // The page: date-ascending, then barber — from the key after the cursor.
    const page = [
      key(maria, '2026-09-25'),
      key(ivan, '2026-09-26'),
      key(maria, '2026-09-26'),
      key(ivan, '2026-09-27'),
      key(maria, '2026-09-27'),
      key(ivan, '2026-09-28'),
      key(maria, '2026-09-28'),
    ];
    expect(world.dayReads.keyReads).toEqual([page]);
    // Maria's 25th is current: not written. Ivan's stale 26th and Maria's
    // missing 26th are; the 27th and 28th are live, skipped by the writer.
    expect(world.dayKeysWritten()).toEqual([
      key(ivan, '2026-09-26'),
      key(maria, '2026-09-26'),
    ]);
    expect(
      world.store.get(analyticsDayPath(key(ivan, '2026-09-26')).join('/')),
    ).toEqual(bodyOf(fixtureDay(key(ivan, '2026-09-26'))));
    expect(world.jobOf()).toMatchObject({
      jobCursor: key(maria, '2026-09-28'),
      jobChecked: 2 + page.length,
      jobWritten: 2 + 2,
      jobFailed: 0,
      jobSteps: 2,
      jobUpdatedAtUtcMs: NOW,
      jobFinishedAtUtcMs: null,
    });
    expect(world.telemetry.lines.at(-1)).toEqual({
      level: 'info',
      msg: 'analytics.recompute_step',
      fields: {
        cursor: key(maria, '2026-09-28'),
        checked: page.length,
        eligible: page.length - 1,
        written: 2,
        skipped: 4,
        kept: 0,
        failed: 0,
        steps: 2,
      },
    });
  });

  it('the step that finds no page left finishes the pass and logs the totals', async () => {
    const fired = passAt(key(maria, '2026-09-28'));
    const world = rig({ job: fired });
    expect(await world.step({ fired })).toEqual({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Finished, ...quiet },
    });
    expect(world.jobOf()).toMatchObject({
      jobFinishedAtUtcMs: NOW,
      jobCursor: key(maria, '2026-09-28'),
      jobChecked: 2,
      jobWritten: 2,
    });
    expect(world.dayReads.keyReads).toEqual([]);
    expect(world.telemetry.lines).toEqual([
      {
        level: 'info',
        msg: 'analytics.recompute_done',
        fields: {
          barbers: 2,
          checked: 2,
          written: 2,
          failed: 0,
          steps: 1,
          fullReach: false,
        },
      },
    ]);
    // The finish's own write fires a delivery that rests.
    const finished = world.jobOf();
    expect(await world.step({ fired: finished })).toEqual({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Idle, ...quiet },
    });
  });

  it('a whole pass, step by step, writes every past day of its window once and rests', async () => {
    const fired = passAt(null, '2026-09-25');
    const world = rig({ job: fired });
    const outcomes: PolicyStepOutcome[] = [];
    for (let guard = 0; guard < 5; guard++) {
      const report = await world.step({ fired: world.jobOf() });
      const outcome = report.ok ? report.value.analyticsStepOutcome : null;
      if (outcome === null) break;
      outcomes.push(outcome);
      if (outcome !== PolicyStepOutcome.Advanced) break;
    }
    expect(outcomes).toEqual([
      PolicyStepOutcome.Advanced,
      PolicyStepOutcome.Finished,
    ]);
    // The writer takes a page's keys sorted — barber first, then day.
    expect(world.dayKeysWritten()).toEqual([
      key(ivan, '2026-09-25'),
      key(ivan, '2026-09-26'),
      key(maria, '2026-09-25'),
      key(maria, '2026-09-26'),
    ]);
    expect(world.jobOf()).toMatchObject({
      jobChecked: 8,
      jobWritten: 4,
      jobFailed: 0,
      jobSteps: 1,
    });
  });
});

describe('continueAnalyticsRecompute — the compare-and-set', () => {
  it('rests on no job, a finished pass and a recorded stall', async () => {
    const world = rig({ job: null });
    expect(await world.step({ fired: null })).toEqual({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Idle, ...quiet },
    });
    const stalled = AnalyticsRecomputeJobSystem.stall(
      passAt(null),
      'internal',
      NOW,
    );
    expect(await world.step({ fired: stalled })).toMatchObject({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Idle },
    });
    expect(world.tx.transactions).toEqual([]);
  });

  it('a stale delivery — the job moved on — writes nothing and reads no page', async () => {
    const fired = passAt(null);
    const moved = passAt(key(ivan, '2026-09-25'));
    const world = rig({ job: moved });
    expect(await world.step({ fired })).toEqual({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Superseded, ...quiet },
    });
    expect(world.dayReads.keyReads).toEqual([]);
    expect(world.tx.plans).toEqual([]);
  });

  it('a pass restarted between the page and the advance: the page’s days are written, the job is not', async () => {
    const fired = passAt(null);
    let commits = 0;
    const world = rig({
      job: fired,
      commit: (commit) => (read, decide) => {
        commits += 1;
        return commit(read, decide);
      },
    });
    // Another sweep restarts the pass while this step writes its days.
    const restarted = AnalyticsRecomputeJobSystem.start(
      AnalyticsRecomputeJobSystem.extentOfPass(fired, localDate('2026-09-28')),
      NOW,
    );
    const origin = world.ports.loadAnalyticsDaysByKeys;
    const step = continueAnalyticsRecompute({
      ...world.ports,
      loadAnalyticsDaysByKeys: async (keys) => {
        world.store.set(
          ANALYTICS_RECOMPUTE_JOB_PATH.join('/'),
          bodyOf(restarted),
        );
        return origin(keys);
      },
    });
    expect(await step({ fired })).toEqual({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Superseded, ...quiet },
    });
    expect(world.dayKeysWritten()).toHaveLength(6);
    expect(world.jobOf()).toEqual(restarted);
    expect(commits).toBe(7);
  });
});

describe('continueAnalyticsRecompute — failures', () => {
  it('a transient failure on the page stalls the step without advancing — the redelivery runs the same page', async () => {
    const fired = passAt(key(ivan, '2026-09-27'));
    const world = rig({ job: fired });
    const down = RepositoryError.readFailed(
      Collections.Appointments,
      'unavailable',
    );
    const step = continueAnalyticsRecompute({
      ...world.ports,
      loadVisitsByBusyKeys: async () => Result.err(down),
    });
    const report = await step({ fired });
    expect(report.ok && report.value.analyticsStepOutcome).toBe(
      PolicyStepOutcome.Stalled,
    );
    expect(report.ok && report.value.attemptFailure).toMatchObject({
      attemptOutcome: AttemptOutcome.Transient,
      failureCode: 'unavailable',
    });
    expect(world.jobOf()).toEqual(fired);
  });

  it('a permanent failure on a day is counted and survived: the page is finished, the failure logged by the edge', async () => {
    const fired = passAt(key(ivan, '2026-09-27'));
    const world = rig({ job: fired });
    const denied = RepositoryError.readFailed(
      Collections.Appointments,
      'permission-denied',
    );
    const step = continueAnalyticsRecompute({
      ...world.ports,
      loadVisitsByBusyKeys: async () => Result.err(denied),
    });
    const report = await step({ fired });
    expect(report.ok && report.value).toMatchObject({
      analyticsStepOutcome: PolicyStepOutcome.Advanced,
      attemptFailure: null,
      survivedFailure: {
        attemptOutcome: AttemptOutcome.Permanent,
        failureCode: 'permission-denied',
      },
    });
    // The read fails before the day is known to be live: all three count.
    expect(world.jobOf()).toMatchObject({
      jobCursor: key(maria, '2026-09-28'),
      jobChecked: 2 + 3,
      jobFailed: 3,
      jobWritten: 2,
    });
  });

  it('a step that cannot move the pass on a permanent failure records the stall on the job, once', async () => {
    const fired = passAt(key(maria, '2026-09-28'));
    let commits = 0;
    const world = rig({
      job: fired,
      commit: (commit) => (read, decide) => {
        commits += 1;
        if (commits === 1) {
          throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
        }
        return commit(read, decide);
      },
    });
    const report = await world.step({ fired });
    expect(report.ok && report.value).toMatchObject({
      analyticsStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: { failureCode: 'permission-denied' },
    });
    expect(world.jobOf()).toEqual(
      AnalyticsRecomputeJobSystem.stall(fired, 'permission-denied', NOW),
    );
    // The stall's own write delivers a step that rests.
    expect(await world.step({ fired: world.jobOf() })).toMatchObject({
      ok: true,
      value: { analyticsStepOutcome: PolicyStepOutcome.Idle },
    });
  });
});
