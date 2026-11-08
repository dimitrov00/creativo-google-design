import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ANALYTICS_DEFINITION_VERSION,
  DayFigures,
  PolicyStepOutcome,
  PolicySweepOutcome,
  Seat,
  SeatOutcome,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  type LocalDate,
  SeatId,
  UtcEpochMs,
} from '@core/primitives';
import {
  ANALYTICS_RECOMPUTE_DOC,
  type AnalyticsRecomputeJob,
  type Appointment,
  Collections,
} from '@core/entities';
import { AnalyticsRecomputeJobSystem, ZonedTimeSystem } from '@core/systems';
import {
  continueAnalyticsRecompute,
  startAnalyticsRecompute,
} from '@core/pipelines';
import {
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  barberFixture,
  barberScheduleFixture,
  fixtureHash,
  localDate,
  locationFixture,
  minute,
  pinnedNowUtcMs,
  recordingTelemetry,
  seatFixture,
  sequentialIds,
  termsFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { firestorePorts } from '../adapters/firestore-ports';
import { bodyOf } from '../adapters/store-answer';
import { decodeAnalyticsStepEvent } from '../wire/triggers.wire';

/**
 * The analytics-days recompute against the REAL Firestore emulator (staff
 * analytics v2, PR 4a), over the production assembler: the sweep starts a
 * pass whose window a missed night widened, its steps — each decoded from
 * the job document as the trigger decodes it — read the page's documents by
 * id (`getAll`), write the missing day, the stretch-less day and the
 * version-stale one, leave a current one alone and skip the live days, and
 * the last step finishes the pass. Everything a `getAll`, a compare-and-set
 * on the job and the TTL stamp need the store for.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-analytics-recompute';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/* The clock: Wednesday 30 September 2026, 04:30 in Sofia — the sweep's hour. */
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const CENTRE = FIXTURE_IDS.location;
const NOW = utcMs('2026-09-30T04:30:00.000+03:00');
const SUNDAY = localDate('2026-09-27');
const MONDAY = localDate('2026-09-28');
const TODAY = localDate('2026-09-30');
const JOB_PATH = `${Collections.BackfillJobs}/${ANALYTICS_RECOMPUTE_DOC}`;

function visitOn(id: string, day: LocalDate, barberId: BarberId): Appointment {
  const seat: Seat = seatFixture({
    seatId: SeatId.of(`s-${id}`),
    barberId,
    startMinutes: minute(600),
    terms: Seat.termsOf(termsFixture(2500, 30, 0, 0), null),
    outcome: SeatOutcome.worked(NOW),
  });
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: day,
    startMinutes: seat.startMinutes,
    endMinutes: Seat.endMinutes(seat),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(day, seat.startMinutes, FIXTURE_TIME_ZONE),
    ),
    seats: [seat],
    barberIds: [barberId],
    busyKeys: [BusyKey.of(barberId, day)],
  });
}

/** Ivan and Niko each worked a seat on Monday the 28th. */
const IVAN_MONDAY = visitOn('v-ivan-monday', MONDAY, IVAN);
const NIKO_MONDAY = visitOn('v-niko-monday', MONDAY, NIKO);

/** A pass that finished at `finishedAtUtcMs` under this definition, over both barbers. */
function finishedPass(finishedAtUtcMs: UtcEpochMs): AnalyticsRecomputeJob {
  const started = AnalyticsRecomputeJobSystem.start(
    {
      fromLocalDate: localDate('2025-09-01'),
      toLocalDate: localDate('2026-09-28'),
      barberIds: [IVAN, NIKO],
      fullReach: true,
    },
    UtcEpochMs.plusMs(finishedAtUtcMs, -600_000),
  );
  return AnalyticsRecomputeJobSystem.finish(started, finishedAtUtcMs);
}

describe('the analytics-days recompute (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  /** A stored day of Ivan's Monday, under another definition — eligible. */
  const staleMonday = {
    ...DayFigures.empty(IVAN, MONDAY, UtcEpochMs.plusMs(NOW, -86_400_000)),
    dayWorkedSeatCount: 7,
    dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION - 1,
  };
  /** A stored day of Niko's Sunday, current — not eligible, left as it is. */
  const currentSunday = {
    ...DayFigures.empty(NIKO, SUNDAY, UtcEpochMs.plusMs(NOW, -86_400_000)),
    dayWorkedSeatCount: 3,
  };

  beforeEach(async () => {
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const put = (collection: string, entity: { readonly id: string }) =>
      db.collection(collection).doc(entity.id).set(bodyOf(entity));
    await Promise.all([
      put(Collections.Locations, locationFixture()),
      put(Collections.Barbers, barberFixture({ id: IVAN })),
      put(Collections.Barbers, barberFixture({ id: NIKO })),
      put(Collections.BarberSchedules, barberScheduleFixture({ id: IVAN })),
      put(Collections.BarberSchedules, barberScheduleFixture({ id: NIKO })),
      put(Collections.Appointments, IVAN_MONDAY),
      put(Collections.Appointments, NIKO_MONDAY),
      db
        .collection(Collections.AnalyticsDays)
        .doc(BusyKey.of(IVAN, MONDAY))
        .set(staleMonday),
      db
        .collection(Collections.AnalyticsDays)
        .doc(BusyKey.of(NIKO, SUNDAY))
        .set(currentSunday),
      // The last pass finished the night before last: a missed night.
      db
        .doc(JOB_PATH)
        .set(bodyOf(finishedPass(utcMs('2026-09-28T04:35:00.000+03:00')))),
    ]);
  });

  function ports() {
    const telemetry = recordingTelemetry();
    return {
      telemetry,
      ports: {
        ...firestorePorts(
          db,
          {
            nowUtcMs: pinnedNowUtcMs(NOW),
            nextId: sequentialIds('id'),
            hash: fixtureHash,
          },
          telemetry,
        ),
        ...telemetry,
        defaultLocationId: CENTRE,
      },
    };
  }

  const jobOf = async (): Promise<AnalyticsRecomputeJob> =>
    ({
      id: ANALYTICS_RECOMPUTE_DOC,
      ...(await db.doc(JOB_PATH).get()).data(),
    }) as AnalyticsRecomputeJob;

  async function dayAt(key: BusyKey) {
    return (
      await db.collection(Collections.AnalyticsDays).doc(key).get()
    ).data();
  }

  /** One step, fired by the job document as it is stored now — what the trigger decodes. */
  async function step(world: ReturnType<typeof ports>) {
    const stored = await db.doc(JOB_PATH).get();
    const report = await continueAnalyticsRecompute(world.ports)(
      decodeAnalyticsStepEvent({
        id: `evt-${stored.updateTime?.toMillis() ?? 0}`,
        time: '2026-09-30T01:30:00.000000Z',
        params: {},
        data: {
          after: { exists: stored.exists, data: () => stored.data() },
        },
      }),
    );
    return report.ok ? report.value.analyticsStepOutcome : null;
  }

  it('the sweep widens the window after a missed night, and the steps write the missing, the stretch-less and the version-stale day, keep a current one and finish', async () => {
    const world = ports();
    const swept = await startAnalyticsRecompute(world.ports)();
    expect(swept).toMatchObject({
      ok: true,
      value: { analyticsSweepOutcome: PolicySweepOutcome.Started },
    });
    // Finished on the 28th: the window runs from the 27th (a missed night
    // would otherwise leave the 28th half-written) to today.
    expect(await jobOf()).toMatchObject({
      jobWindowFromLocalDate: SUNDAY,
      jobFullReach: false,
      jobBarberIds: [IVAN, NIKO],
      jobCursor: null,
      jobFinishedAtUtcMs: null,
      jobDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
    });

    // The first step: eight keys (two barbers × the 27th to the 30th).
    expect(await step(world)).toBe(PolicyStepOutcome.Advanced);
    expect(await jobOf()).toMatchObject({
      jobCursor: BusyKey.of(NIKO, TODAY),
      jobChecked: 8,
      // Ivan's Sunday, Ivan's stale Monday, Niko's Monday; Niko's Sunday is
      // current and never handed to the writer; the 29th and 30th are live.
      jobWritten: 3,
      jobFailed: 0,
      jobSteps: 1,
    });
    // The missing day: Niko's Monday, his worked seat on it.
    expect(await dayAt(BusyKey.of(NIKO, MONDAY))).toMatchObject({
      dayWorkedSeatCount: 1,
      dayTakingsCents: 2500,
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      dayComputedAtUtcMs: NOW,
    });
    // The stretch-less day: Ivan's Sunday, zeros throughout, a TTL stamp.
    const sunday = await dayAt(BusyKey.of(IVAN, SUNDAY));
    expect(sunday).toMatchObject({
      ...DayFigures.empty(IVAN, SUNDAY, NOW),
    });
    expect(sunday?.['purgeAt']).toBeDefined();
    // The version-stale day: rewritten under this definition.
    expect(await dayAt(BusyKey.of(IVAN, MONDAY))).toMatchObject({
      dayWorkedSeatCount: 1,
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      dayComputedAtUtcMs: NOW,
    });
    // The current day: left exactly as stored.
    expect(await dayAt(BusyKey.of(NIKO, SUNDAY))).toEqual(currentSunday);
    // The live days: no document.
    expect(await dayAt(BusyKey.of(IVAN, TODAY))).toBeUndefined();
    expect(
      await dayAt(BusyKey.of(NIKO, localDate('2026-09-29'))),
    ).toBeUndefined();

    // The step the advance fires finds no page left and finishes the pass.
    expect(await step(world)).toBe(PolicyStepOutcome.Finished);
    expect(await jobOf()).toMatchObject({
      jobFinishedAtUtcMs: NOW,
      jobSteps: 1,
    });
    expect(
      world.telemetry.lines.filter(
        (line) => line.msg === 'analytics.recompute_done',
      ),
    ).toEqual([
      {
        level: 'info',
        msg: 'analytics.recompute_done',
        fields: {
          barbers: 2,
          checked: 8,
          written: 3,
          failed: 0,
          steps: 1,
          fullReach: false,
        },
      },
    ]);
    // The finish's own write delivers a step that rests.
    expect(await step(world)).toBe(PolicyStepOutcome.Idle);
  });

  it('a second sweep the same night finds a fresh pass and leaves it alone', async () => {
    const world = ports();
    await startAnalyticsRecompute(world.ports)();
    const started = await jobOf();
    expect(await startAnalyticsRecompute(world.ports)()).toMatchObject({
      ok: true,
      value: { analyticsSweepOutcome: PolicySweepOutcome.Idle },
    });
    expect(await jobOf()).toEqual(started);
  });
});
