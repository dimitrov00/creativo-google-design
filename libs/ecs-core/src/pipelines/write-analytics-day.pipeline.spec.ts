import { describe, expect, it } from 'vitest';
import {
  AttemptOutcome,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  DayFigures,
  type DocBody,
  Seat,
  SeatOutcome,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BusyKey,
  LocationId,
  Result,
  type UtcEpochMs,
  UtcEpochMs as Instant,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type Appointment,
  type BarberAnalyticsDay,
  type BarberSchedule,
  Collections,
  QueryOp,
  type ScheduleException,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { StaffAnalyticsSystem } from '@core/systems';
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
  memoryAnalyticsReadPorts,
  memoryDefaultLocationPorts,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import {
  AnalyticsDaySource,
  analyticsDayPath,
  followUpsOf,
  visitsOnBusyDay,
  type WriteAnalyticsDayCommand,
  writeAnalyticsDay,
} from './write-analytics-day.pipeline';

/*
 * The day writer (staff analytics v2, «Shape», «Stamp ordering») over the
 * fixture month at the pinned now (Monday 28 September, 09:00 in Sofia):
 * which days a command names, the one transaction per past day and its
 * read set, the fold it writes (the fixture's day documents are the
 * oracle), the stamp rule that keeps a newer document, the live days it
 * skips, and the failures it collects without failing the rest.
 */

const { ivan, maria, niko } = ANALYTICS_FIXTURE_BARBERS;
const { centre } = ANALYTICS_FIXTURE_SHOPS;
const NOW = FIXTURE_NOW_UTC_MS;

const SOLO = visitNamed('an-solo');
const FOLLOW_UP = visitNamed('an-follow-up');
const TODAY_VISIT = visitNamed('an-today');
const SOLO_KEY = BusyKey.of(ivan, localDate('2026-09-14'));

function visitNamed(id: string): Appointment {
  const visit = ANALYTICS_FIXTURE_VISITS.find((v) => v.id === id);
  if (visit === undefined) throw new Error(`no fixture visit ${id}`);
  return visit;
}

/** The fixture's day document for `key` — what the writer must write, minus its id. */
function expectedBody(key: BusyKey): DocBody {
  const doc = analyticsFixtureDayDocuments().find(
    (day) => String(day.id) === key,
  );
  if (doc === undefined) throw new Error(`no fixture day ${key}`);
  return bodyOf(doc);
}

/** A command with no refused side — nothing salvaged, no refusal (edge-hardening D-3). */
const NOTHING_SALVAGED = {
  salvagedKeys: [],
  salvagedLocationId: null,
  refusal: null,
} as const;

const appointmentWrite = (
  before: Appointment | null,
  after: Appointment | null,
): WriteAnalyticsDayCommand => ({
  analyticsDaySource: AnalyticsDaySource.Appointment,
  before,
  after,
  ...NOTHING_SALVAGED,
});

const departure = (...keys: readonly BusyKey[]): WriteAnalyticsDayCommand => ({
  analyticsDaySource: AnalyticsDaySource.Departure,
  keys,
});

const recompute = (...keys: readonly BusyKey[]): WriteAnalyticsDayCommand => ({
  analyticsDaySource: AnalyticsDaySource.Recompute,
  keys,
});

type World = {
  readonly visits?: readonly Appointment[];
  readonly days?: readonly BarberAnalyticsDay[];
  readonly nowUtcMs?: UtcEpochMs;
  /** Wraps the commit port — a spec fails or counts transactions through it. */
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

/** The fixture world as stored, and the writer over it. */
function rig(world: World = {}) {
  const visits = world.visits ?? ANALYTICS_FIXTURE_VISITS;
  const store = memoryStore([
    ...visits.map((visit) => ({
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
  ]);
  const tx = memoryTxPorts(store, {
    nowUtcMs: () => world.nowUtcMs ?? NOW,
  });
  const telemetry = recordingTelemetry();
  const analytics = memoryAnalyticsReadPorts({
    visits,
    departures: ANALYTICS_FIXTURE_DEPARTURES,
    barberIds: [ivan, maria, niko],
    locations: ANALYTICS_FIXTURE_LOCATIONS,
  });
  const at = <E>(path: readonly string[]): E | null => {
    const body = store.get(path.join('/'));
    return body === undefined
      ? null
      : ({ id: path[path.length - 1], ...body } as E);
  };
  const ports = {
    ...tx,
    commit: world.commit === undefined ? tx.commit : world.commit(tx.commit),
    ...telemetry,
    ...analytics.ports,
    loadSchedule: async (barberId: string) =>
      Result.ok(at<BarberSchedule>([Collections.BarberSchedules, barberId])),
    loadScheduleException: async (key: string) =>
      Result.ok(at<ScheduleException>([Collections.ScheduleExceptions, key])),
    loadBusyDay: async () => Result.ok(null),
    loadAppointment: async (id: string) =>
      Result.ok(at<Appointment>([Collections.Appointments, id])),
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    ...memoryDefaultLocationPorts(centre),
  };
  return {
    store,
    tx,
    telemetry,
    analytics,
    ports,
    run: writeAnalyticsDay(ports),
    /** The stored day document at `key`, `null` when none. */
    dayAt: (key: BusyKey) => store.get(analyticsDayPath(key).join('/')) ?? null,
  };
}

/** The `AnalyticsDayWritten` lines logged, their fields. */
const writtenLines = (telemetry: ReturnType<typeof recordingTelemetry>) =>
  telemetry.lines
    .filter((line) => line.msg === 'analytics.day_written')
    .map((line) => line.fields);

const failedLines = (telemetry: ReturnType<typeof recordingTelemetry>) =>
  telemetry.lines
    .filter((line) => line.msg === 'analytics.day_write_failed')
    .map((line) => line.fields);

describe('writeAnalyticsDay — which days an event names', () => {
  it('an appointment write: the busy keys of both sides, each past day written as ONE Set of the fold', async () => {
    const { tx, telemetry, run } = rig();
    const answer = await run(appointmentWrite(null, SOLO));
    expect(answer).toEqual({
      ok: true,
      value: {
        writtenKeys: [SOLO_KEY],
        skippedKeys: [],
        keptKeys: [],
        failedKeys: [],
        failures: [],
        attemptFailure: null,
      },
    });
    expect(tx.plans).toEqual([
      [WriteOp.set(analyticsDayPath(SOLO_KEY), expectedBody(SOLO_KEY))],
    ]);
    expect(writtenLines(telemetry)).toEqual([
      {
        barberId: ivan,
        localDate: '2026-09-14',
        source: 'APPOINTMENT',
        visitCount: 2,
        durationMs: 0,
      },
    ]);
  });

  it('reads the day inside the transaction: every visit holding the key (no status filter, the cap + 1), the follow-ups of its visits in one `in` chunk, the document and the departure', async () => {
    const { tx, run } = rig();
    await run(appointmentWrite(null, SOLO));
    const transaction = tx.transactions[0];
    const overBreak = visitNamed('an-over-break');
    expect(transaction?.queries).toEqual([
      visitsOnBusyDay(SOLO_KEY),
      followUpsOf([SOLO.id, overBreak.id]),
    ]);
    expect(visitsOnBusyDay(SOLO_KEY)).toEqual({
      collection: [Collections.Appointments],
      where: [
        { field: 'busyKeys', op: QueryOp.ArrayContains, value: SOLO_KEY },
      ],
      orderBy: [],
      limit: StaffAnalyticsSystem.VISITS_PER_BARBER_DAY + 1,
    });
    expect(followUpsOf([SOLO.id])).toEqual({
      collection: [Collections.Appointments],
      where: [
        {
          field: 'bookedFromAppointmentId',
          op: QueryOp.In,
          value: [SOLO.id],
        },
      ],
      orderBy: [],
      limit: StaffAnalyticsSystem.FOLLOW_UPS_PER_VISIT + 1,
    });
    expect(transaction?.reads).toEqual([
      analyticsDayPath(SOLO_KEY),
      [Collections.ScheduleExceptions, SOLO_KEY],
    ]);
  });

  it('skips a day that is not yet past — today, yesterday — without a transaction: the report computes it live', async () => {
    const { tx, run } = rig();
    const answer = await run(appointmentWrite(null, TODAY_VISIT));
    expect(answer.ok && answer.value.skippedKeys).toEqual([
      BusyKey.of(ivan, localDate('2026-09-28')),
    ]);
    expect(answer.ok && answer.value.writtenKeys).toEqual([]);
    expect(tx.transactions).toEqual([]);
  });

  it('a departure or a recompute names its keys — each once, sorted, written as the fold', async () => {
    const { tx, run } = rig();
    const party = BusyKey.of(maria, localDate('2026-09-15'));
    const answer = await run(departure(SOLO_KEY, party, SOLO_KEY));
    expect(answer.ok && answer.value.writtenKeys).toEqual([SOLO_KEY, party]);
    expect(tx.plans).toEqual([
      [WriteOp.set(analyticsDayPath(SOLO_KEY), expectedBody(SOLO_KEY))],
      [WriteOp.set(analyticsDayPath(party), expectedBody(party))],
    ]);
    const { tx: tx2, run: run2 } = rig();
    await run2(recompute(party));
    expect(tx2.plans).toEqual([
      [WriteOp.set(analyticsDayPath(party), expectedBody(party))],
    ]);
  });

  it('a command naming no day writes nothing; a refused side naming none answers its refusal (as the busy rebuild rules)', async () => {
    const { tx, run } = rig();
    expect(await run(departure())).toEqual({
      ok: true,
      value: {
        writtenKeys: [],
        skippedKeys: [],
        keptKeys: [],
        failedKeys: [],
        failures: [],
        attemptFailure: null,
      },
    });
    const refusal = RepositoryError.malformed(
      `${Collections.Appointments}/${SOLO.id}`,
      'busyKeys',
    );
    expect(
      await run({
        analyticsDaySource: AnalyticsDaySource.Appointment,
        before: null,
        after: null,
        salvagedKeys: [],
        salvagedLocationId: centre,
        refusal,
      }),
    ).toEqual({ ok: false, error: refusal });
    // A refused side that still names its day: that day is rebuilt, the
    // refusal is not the answer.
    const salvaged = await run({
      analyticsDaySource: AnalyticsDaySource.Appointment,
      before: null,
      after: null,
      salvagedKeys: [SOLO_KEY],
      salvagedLocationId: centre,
      refusal,
    });
    expect(salvaged.ok && salvaged.value.writtenKeys).toEqual([SOLO_KEY]);
    expect(tx.plans).toHaveLength(1);
  });
});

describe('writeAnalyticsDay — the follow-up’s source day', () => {
  /** The October follow-up, cancelled by the client the day it was booked. */
  const CANCELLED_AT = utcMs('2026-09-14T12:00:00.000+03:00');
  const seat = FOLLOW_UP.seats[0] as Seat;
  const cancelledFollowUp: Appointment = {
    ...FOLLOW_UP,
    seats: [
      {
        ...seat,
        ...SeatOutcome.cancelled(
          CANCELLED_AT,
          CancelledBy.Client,
          CancellationReason.ClientChangedPlans,
          null,
        ),
      },
    ],
    ...BookingLifecycle.cancel(
      CANCELLED_AT,
      CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
    ),
  };

  it('a follow-up’s write rebuilds the source visit’s past day — the follow-up’s own live day is skipped', async () => {
    const { tx, run } = rig();
    const answer = await run(appointmentWrite(null, FOLLOW_UP));
    expect(answer.ok && answer.value).toMatchObject({
      writtenKeys: [SOLO_KEY],
      skippedKeys: [BusyKey.of(ivan, localDate('2026-10-12'))],
    });
    // The fixture day already counts the follow-up: one rebooked of two.
    expect(tx.plans).toEqual([
      [WriteOp.set(analyticsDayPath(SOLO_KEY), expectedBody(SOLO_KEY))],
    ]);
    expect(tx.plans[0]?.[0]).toMatchObject({
      body: { dayRebookedBase: 2, dayRebookedCount: 1 },
    });
  });

  it('a cancelled follow-up rewrites the source day without its rebooking', async () => {
    const visits = ANALYTICS_FIXTURE_VISITS.map((visit) =>
      visit.id === FOLLOW_UP.id ? cancelledFollowUp : visit,
    );
    const { tx, run } = rig({ visits });
    const answer = await run(appointmentWrite(FOLLOW_UP, cancelledFollowUp));
    expect(answer.ok && answer.value.writtenKeys).toEqual([SOLO_KEY]);
    expect(tx.plans[0]?.[0]).toMatchObject({
      path: analyticsDayPath(SOLO_KEY),
      body: {
        ...expectedBody(SOLO_KEY),
        dayRebookedBase: 2,
        dayRebookedCount: 0,
      },
    });
    // The source visit enters the day's conflict set.
    expect(tx.transactions[0]?.reads).toEqual([
      analyticsDayPath(SOLO_KEY),
      [Collections.Appointments, SOLO.id],
      [Collections.ScheduleExceptions, SOLO_KEY],
    ]);
  });

  it('a source that cannot be read costs its own day only — collected, the sides’ days still written', async () => {
    const world = rig();
    const refusal = RepositoryError.malformed(
      `${Collections.Appointments}/${SOLO.id}`,
      'seats[0].startMinutes',
    );
    const run = writeAnalyticsDay({
      ...world.ports,
      loadAppointment: async () => Result.err(refusal),
    });
    const answer = await run(appointmentWrite(null, FOLLOW_UP));
    expect(answer.ok && answer.value).toMatchObject({
      writtenKeys: [],
      skippedKeys: [BusyKey.of(ivan, localDate('2026-10-12'))],
      failedKeys: [],
      failures: [refusal],
    });
    expect(answer.ok && answer.value.attemptFailure).toMatchObject({
      attemptOutcome: AttemptOutcome.Permanent,
      failureCode: 'data-loss',
    });
    expect(failedLines(world.telemetry)).toEqual([
      { key: null, code: 'data-loss' },
    ]);
  });
});

describe('writeAnalyticsDay — stamp ordering (Law 7 T2)', () => {
  const stored = (computedAtUtcMs: UtcEpochMs): BarberAnalyticsDay => ({
    ...(analyticsFixtureDayDocuments().find(
      (day) => String(day.id) === SOLO_KEY,
    ) as BarberAnalyticsDay),
    dayWorkedSeatCount: 99,
    dayComputedAtUtcMs: computedAtUtcMs,
  });

  it('rewrites a document computed from OLDER reads, and keeps one computed from reads at or after its own', async () => {
    const older = rig({ days: [stored(Instant.plusMs(NOW, -1))] });
    const rewritten = await older.run(departure(SOLO_KEY));
    expect(rewritten.ok && rewritten.value.writtenKeys).toEqual([SOLO_KEY]);
    expect(older.dayAt(SOLO_KEY)).toEqual(expectedBody(SOLO_KEY));

    const same = rig({ days: [stored(NOW)] });
    const kept = await same.run(departure(SOLO_KEY));
    expect(kept.ok && kept.value).toMatchObject({
      writtenKeys: [],
      keptKeys: [SOLO_KEY],
    });
    expect(same.tx.plans).toEqual([[]]);
    expect(same.dayAt(SOLO_KEY)).toMatchObject({ dayWorkedSeatCount: 99 });

    const newer = rig({ days: [stored(Instant.plusMs(NOW, 1))] });
    const left = await newer.run(departure(SOLO_KEY));
    expect(left.ok && left.value.keptKeys).toEqual([SOLO_KEY]);
    expect(newer.dayAt(SOLO_KEY)).toMatchObject({ dayWorkedSeatCount: 99 });
  });

  it('two writers racing: the one that read later wins, whichever commits last', async () => {
    const world = rig();
    // The later reader writes first…
    const later = writeAnalyticsDay({
      ...world.ports,
      nowUtcMs: () => Instant.plusMs(NOW, 60_000),
    });
    await later(departure(SOLO_KEY));
    expect(world.dayAt(SOLO_KEY)).toMatchObject({
      dayComputedAtUtcMs: Instant.plusMs(NOW, 60_000),
    });
    // …and the earlier reader, committing after it, never overwrites it.
    const earlier = await world.run(departure(SOLO_KEY));
    expect(earlier.ok && earlier.value).toMatchObject({
      writtenKeys: [],
      keptKeys: [SOLO_KEY],
    });
    expect(world.dayAt(SOLO_KEY)).toMatchObject({
      dayComputedAtUtcMs: Instant.plusMs(NOW, 60_000),
    });
    expect(world.tx.plans).toHaveLength(2);
    expect(world.tx.plans[1]).toEqual([]);
  });
});

describe('writeAnalyticsDay — a stretch-less past day', () => {
  it('writes zeros for a day the barber is not rostered on — a document for every past calendar day', async () => {
    // Maria works Tuesday to Friday: Monday the 21st rosters nothing.
    const monday = BusyKey.of(maria, localDate('2026-09-21'));
    const { tx, run } = rig();
    await run(recompute(monday));
    expect(tx.plans).toEqual([
      [
        WriteOp.set(
          analyticsDayPath(monday),
          DayFigures.empty(maria, localDate('2026-09-21'), NOW),
        ),
      ],
    ]);
    expect(tx.plans[0]?.[0]).toEqual(
      WriteOp.set(analyticsDayPath(monday), expectedBody(monday)),
    );
  });

  it('counts a worked seat on a day with no stretch as time outside hours — the hidden shop’s Saturday', async () => {
    const saturday = BusyKey.of(maria, localDate('2026-09-19'));
    const { tx, run } = rig();
    await run(recompute(saturday));
    expect(tx.plans[0]?.[0]).toMatchObject({
      body: {
        dayRosteredMinutes: 0,
        dayOutsideHoursSeatCount: 1,
        dayOutsideHoursMinutes: 30,
        dayWorkedSeatCount: 1,
      },
    });
    expect(tx.plans[0]?.[0]).toEqual(
      WriteOp.set(analyticsDayPath(saturday), expectedBody(saturday)),
    );
  });
});

describe('writeAnalyticsDay — failures are collected, never fatal', () => {
  it('refuses a day holding one visit over the cap as `resource-exhausted` — and still writes the next day', async () => {
    const crowded = BusyKey.of(niko, localDate('2026-09-22'));
    const extra = Array.from({ length: 61 }, (_, i) => ({
      ...visitNamed('an-no-show'),
      id: AppointmentId.of(`crowd-${i}`),
      localDate: localDate('2026-09-22'),
      busyKeys: [crowded],
    }));
    const { tx, telemetry, run } = rig({
      visits: [...ANALYTICS_FIXTURE_VISITS, ...extra],
    });
    const answer = await run(departure(crowded, SOLO_KEY));
    const refused = RepositoryError.readFailed(
      Collections.Appointments,
      'resource-exhausted',
    );
    expect(answer.ok && answer.value).toMatchObject({
      writtenKeys: [SOLO_KEY],
      failedKeys: [crowded],
      failures: [refused],
    });
    expect(answer.ok && answer.value.attemptFailure).toMatchObject({
      failureCode: 'resource-exhausted',
      attemptOutcome: AttemptOutcome.Transient,
    });
    expect(tx.plans).toEqual([
      [WriteOp.set(analyticsDayPath(SOLO_KEY), expectedBody(SOLO_KEY))],
    ]);
    expect(failedLines(telemetry)).toEqual([
      { key: crowded, code: 'resource-exhausted' },
    ]);
  });

  it('a commit that rejects is one day’s failure: logged with the key and its code, the other days written, the verdict the edge’s', async () => {
    const party = BusyKey.of(maria, localDate('2026-09-15'));
    let commits = 0;
    const { tx, telemetry, run } = rig({
      commit: (commit) => (read, decide) => {
        commits += 1;
        if (commits === 1) {
          throw Object.assign(new Error('10 ABORTED'), { code: 10 });
        }
        return commit(read, decide);
      },
    });
    const answer = await run(departure(SOLO_KEY, party));
    expect(answer.ok && answer.value).toMatchObject({
      writtenKeys: [party],
      failedKeys: [SOLO_KEY],
    });
    expect(answer.ok && answer.value.attemptFailure).toMatchObject({
      failureCode: 'aborted',
      attemptOutcome: AttemptOutcome.Transient,
    });
    expect(tx.plans).toEqual([
      [WriteOp.set(analyticsDayPath(party), expectedBody(party))],
    ]);
    expect(failedLines(telemetry)).toEqual([
      { key: SOLO_KEY, code: 'aborted' },
    ]);
  });

  it('a read outside the transaction that fails is that day’s failure too', async () => {
    const world = rig();
    const down = RepositoryError.readFailed(
      `${Collections.BarberSchedules}/${ivan}`,
      'unavailable',
    );
    const run = writeAnalyticsDay({
      ...world.ports,
      loadSchedule: async (barberId) =>
        barberId === ivan
          ? Result.err(down)
          : world.ports.loadSchedule(barberId),
    });
    const party = BusyKey.of(maria, localDate('2026-09-15'));
    const answer = await run(departure(SOLO_KEY, party));
    expect(answer.ok && answer.value).toMatchObject({
      writtenKeys: [party],
      failedKeys: [SOLO_KEY],
      failures: [down],
    });
  });

  it('a policy or shop list that cannot be read is the whole command’s failure — no day decided on a guess', async () => {
    const world = rig();
    const down = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'aborted',
    );
    const run = writeAnalyticsDay({
      ...world.ports,
      loadPolicy: async () => Result.err(down),
    });
    expect(await run(departure(SOLO_KEY))).toEqual({ ok: false, error: down });
    expect(world.tx.transactions).toEqual([]);
  });

  it('reads the default shop’s zone from the shops listed — a deployment with none is a store failure', async () => {
    const world = rig();
    const run = writeAnalyticsDay({
      ...world.ports,
      listLocations: async () => Result.ok([]),
      ...memoryDefaultLocationPorts(LocationId.of('loc-nowhere')),
    });
    const answer = await run(departure(SOLO_KEY));
    expect(answer).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        `${Collections.Locations}/loc-nowhere`,
        'CATALOG_LOCATION_ZONE_UNKNOWN',
      ),
    });
  });
});
