import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsPeriod,
  AttemptOutcome,
  PolicySweepOutcome,
  WriteOp,
} from '@core/components';
import {
  BarberId,
  BusyKey,
  LocationId,
  Result,
  type TimeZone,
  type UtcEpochMs,
  UtcEpochMs as Instant,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  ANALYTICS_RECOMPUTE_DOC,
  type AnalyticsRecomputeJob,
  Collections,
} from '@core/entities';
import { AnalyticsRecomputeJobSystem, ZonedTimeSystem } from '@core/systems';
import {
  bodyOf,
  FIXTURE_IDS,
  localDate,
  locationFixture,
  memoryAnalyticsReadPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  ANALYTICS_RECOMPUTE_JOB_PATH,
  analyticsJobWrite,
  startAnalyticsRecompute,
} from './start-analytics-recompute.pipeline';

/*
 * The 04:30 sweep's one write (staff analytics v2, «The recompute's job
 * document»): a new pass over the extent `extentOf` resolves on the default
 * shop's day, a stalled pass nudged, a moving one left alone. Which extent
 * is the job system's spec; this one pins the zone the day is read on, the
 * window a missed night widens, and the plan that reached the commit.
 */

const CENTRE = FIXTURE_IDS.location;
const HONOLULU_SHOP = LocationId.of('loc-honolulu');
const HONOLULU: TimeZone = unwrapOk(
  ZonedTimeSystem.checkZone('Pacific/Honolulu'),
);
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');

/** 22:30 UTC: already Tuesday the 29th in Sofia, still Monday the 28th in Honolulu. */
const NOW = utcMs('2026-09-28T22:30:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;

function rig(
  job: AnalyticsRecomputeJob | null = null,
  options: {
    readonly nowUtcMs?: UtcEpochMs;
    readonly defaultLocationId?: LocationId;
    readonly barberIds?: readonly BarberId[];
  } = {},
) {
  const store = memoryStore(
    job === null
      ? []
      : [{ path: ANALYTICS_RECOMPUTE_JOB_PATH, body: bodyOf(job) }],
  );
  const tx = memoryTxPorts(store, {
    nowUtcMs: () => options.nowUtcMs ?? NOW,
  });
  const telemetry = recordingTelemetry();
  const analytics = memoryAnalyticsReadPorts({
    barberIds: options.barberIds ?? [NIKO, IVAN],
  });
  const ports = {
    ...tx,
    ...telemetry,
    ...analytics.ports,
    ...memoryLocationLoadPorts(
      memoryProgramsWorld({
        locations: [
          locationFixture(),
          locationFixture({ id: HONOLULU_SHOP, timeZone: HONOLULU }),
        ],
      }),
    ),
    ...memoryDefaultLocationPorts(options.defaultLocationId ?? CENTRE),
  };
  const jobOf = (): AnalyticsRecomputeJob | null => {
    const body = store.get(ANALYTICS_RECOMPUTE_JOB_PATH.join('/'));
    return body === undefined
      ? null
      : ({ id: ANALYTICS_RECOMPUTE_DOC, ...body } as AnalyticsRecomputeJob);
  };
  return {
    store,
    tx,
    telemetry,
    ports,
    jobOf,
    run: startAnalyticsRecompute(ports),
  };
}

const quiet = { attemptFailure: null, survivedFailure: null } as const;

/** A pass finished at `finishedAtUtcMs`, under this definition, over the fixture barbers. */
function finishedPass(finishedAtUtcMs: UtcEpochMs): AnalyticsRecomputeJob {
  const started = AnalyticsRecomputeJobSystem.start(
    {
      fromLocalDate: localDate('2025-09-01'),
      toLocalDate: localDate('2026-09-27'),
      barberIds: [IVAN, NIKO],
      fullReach: true,
    },
    Instant.plusMs(finishedAtUtcMs, -10 * MINUTE),
  );
  return AnalyticsRecomputeJobSystem.finish(started, finishedAtUtcMs);
}

describe('startAnalyticsRecompute — today is the default shop’s day', () => {
  it('starts a full pass when there is no job: the reach on the default shop’s calendar — Sofia already on the 29th', async () => {
    const { tx, run, jobOf } = rig();
    expect(await run()).toEqual({
      ok: true,
      value: { analyticsSweepOutcome: PolicySweepOutcome.Started, ...quiet },
    });
    const expected = AnalyticsRecomputeJobSystem.start(
      AnalyticsRecomputeJobSystem.extentOf(
        null,
        localDate('2026-09-29'),
        null,
        [NIKO, IVAN],
      ),
      NOW,
    );
    expect(tx.plans).toEqual([[analyticsJobWrite(expected)]]);
    expect(analyticsJobWrite(expected)).toEqual(
      WriteOp.set(
        [Collections.BackfillJobs, ANALYTICS_RECOMPUTE_DOC],
        bodyOf(expected),
      ),
    );
    expect(jobOf()).toMatchObject({
      jobBarberIds: [IVAN, NIKO],
      jobWindowFromLocalDate: AnalyticsPeriod.earliestOn(
        localDate('2026-09-29'),
      ),
      jobFullReach: true,
      jobCursor: null,
      jobFinishedAtUtcMs: null,
    });
    expect(tx.transactions[0]?.reads).toEqual([ANALYTICS_RECOMPUTE_JOB_PATH]);
  });

  it('the same instant on a shop ten hours behind is still the 28th: the extent ends a day earlier', async () => {
    const { run, telemetry } = rig(null, { defaultLocationId: HONOLULU_SHOP });
    await run();
    expect(telemetry.lines).toEqual([
      {
        level: 'info',
        msg: 'analytics.recompute_swept',
        fields: {
          outcome: PolicySweepOutcome.Started,
          fullReach: true,
          fromLocalDate: AnalyticsPeriod.earliestOn(localDate('2026-09-28')),
          toLocalDate: '2026-09-28',
          barbers: 2,
          cursor: null,
          lastFailureCode: null,
        },
      },
    ]);
  });
});

describe('startAnalyticsRecompute — the window since the last pass', () => {
  it('a pass that finished last night walks the window from the day before it to today', async () => {
    // Finished 04:35 Sofia on the 28th; now 04:30 Sofia on the 29th.
    const lastNight = utcMs('2026-09-28T01:35:00.000Z');
    const { run, jobOf } = rig(finishedPass(lastNight), {
      nowUtcMs: utcMs('2026-09-29T01:30:00.000Z'),
    });
    expect(await run()).toMatchObject({
      ok: true,
      value: { analyticsSweepOutcome: PolicySweepOutcome.Started },
    });
    expect(jobOf()).toMatchObject({
      jobWindowFromLocalDate: '2026-09-27',
      jobFullReach: false,
      jobCursor: null,
    });
  });

  it('a missed night widens the window by itself — the pass that finished two nights ago', async () => {
    const twoNightsAgo = utcMs('2026-09-27T01:35:00.000Z');
    const { run, jobOf } = rig(finishedPass(twoNightsAgo), {
      nowUtcMs: utcMs('2026-09-29T01:30:00.000Z'),
    });
    await run();
    expect(jobOf()).toMatchObject({
      jobWindowFromLocalDate: '2026-09-26',
      jobFullReach: false,
    });
  });

  it('a definition bump or a changed barber list walks the full reach again', async () => {
    const stale: AnalyticsRecomputeJob = {
      ...finishedPass(utcMs('2026-09-28T01:35:00.000Z')),
      jobDefinitionVersion: ANALYTICS_DEFINITION_VERSION - 1,
    };
    const bumped = rig(stale, { nowUtcMs: utcMs('2026-09-29T01:30:00.000Z') });
    await bumped.run();
    expect(bumped.jobOf()).toMatchObject({
      jobFullReach: true,
      jobDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      jobWindowFromLocalDate: AnalyticsPeriod.earliestOn(
        localDate('2026-09-29'),
      ),
    });
    const hired = rig(finishedPass(utcMs('2026-09-28T01:35:00.000Z')), {
      nowUtcMs: utcMs('2026-09-29T01:30:00.000Z'),
      barberIds: [IVAN, NIKO, BarberId.of('b-maria')],
    });
    await hired.run();
    expect(hired.jobOf()).toMatchObject({
      jobFullReach: true,
      jobBarberIds: [IVAN, BarberId.of('b-maria'), NIKO],
    });
  });
});

describe('startAnalyticsRecompute — a running pass', () => {
  const running = (updatedAgoMs: number): AnalyticsRecomputeJob => {
    const started = AnalyticsRecomputeJobSystem.start(
      AnalyticsRecomputeJobSystem.extentOf(
        null,
        localDate('2026-09-29'),
        null,
        [IVAN, NIKO],
      ),
      Instant.plusMs(NOW, -2 * DAY),
    );
    return AnalyticsRecomputeJobSystem.advance(
      {
        ...started,
        jobStalledAtUtcMs: Instant.plusMs(NOW, -updatedAgoMs + MINUTE),
        jobLastFailureCode: 'internal',
      },
      {
        cursor: BusyKey.of(NIKO, localDate('2026-09-20')),
        checked: 100,
        written: 40,
        failed: 1,
      },
      Instant.plusMs(NOW, -updatedAgoMs),
    );
  };

  it('is never started twice: a pass that moved within the quarter hour is left alone', async () => {
    const { tx, run } = rig(running(5 * MINUTE));
    expect(await run()).toEqual({
      ok: true,
      value: { analyticsSweepOutcome: PolicySweepOutcome.Idle, ...quiet },
    });
    expect(tx.plans).toEqual([[]]);
  });

  it('nudges a pass that stopped moving: the stamp refreshed, the stall cleared, the cursor and the step kept', async () => {
    const stalled: AnalyticsRecomputeJob = {
      ...running(16 * MINUTE),
      jobStalledAtUtcMs: Instant.plusMs(NOW, -15 * MINUTE),
      jobLastFailureCode: 'internal',
    };
    const { run, jobOf, telemetry } = rig(stalled);
    expect(await run()).toEqual({
      ok: true,
      value: { analyticsSweepOutcome: PolicySweepOutcome.Nudged, ...quiet },
    });
    expect(jobOf()).toEqual({
      ...stalled,
      jobUpdatedAtUtcMs: NOW,
      jobStalledAtUtcMs: null,
    });
    expect(
      AnalyticsRecomputeJobSystem.sameStep(
        jobOf() as AnalyticsRecomputeJob,
        stalled,
      ),
    ).toBe(true);
    expect(telemetry.lines[0]?.fields).toMatchObject({
      outcome: PolicySweepOutcome.Nudged,
      cursor: stalled.jobCursor,
      lastFailureCode: 'internal',
    });
  });
});

describe('startAnalyticsRecompute — failures', () => {
  it('answers a zone, record list or job read that fails as the sweep’s own failure — nothing written', async () => {
    const world = rig();
    const down = RepositoryError.readFailed(Collections.Barbers, 'unavailable');
    const run = startAnalyticsRecompute({
      ...world.ports,
      listBarberRecordIds: async () => Result.err(down),
    });
    const answer = await run();
    expect(answer.ok && answer.value.analyticsSweepOutcome).toBe(
      PolicySweepOutcome.Failed,
    );
    expect(answer.ok && answer.value.attemptFailure).toMatchObject({
      error: down,
      attemptOutcome: AttemptOutcome.Transient,
    });
    expect(world.tx.transactions).toEqual([]);

    const noShop = startAnalyticsRecompute({
      ...world.ports,
      ...memoryDefaultLocationPorts(LocationId.of('loc-nowhere')),
    });
    const refused = await noShop();
    expect(refused.ok && refused.value.attemptFailure).toMatchObject({
      attemptOutcome: AttemptOutcome.Permanent,
    });
  });
});
