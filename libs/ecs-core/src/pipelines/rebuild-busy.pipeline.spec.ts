import { describe, expect, it } from 'vitest';
import {
  AttemptOutcome,
  BlockKind,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  type DocBody,
  MinuteBlock,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BookingStatus,
  BusyKey,
  type LocalDate,
  LocationId,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type Appointment, Collections, QueryOp } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import {
  appointmentFixture,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  memoryTxPorts,
  minute,
  recordingTelemetry,
  seatFixture,
} from '@core/testing';
import { liveOnBusyDay, rebuildBusy } from './rebuild-busy.pipeline';

/*
 * The busy projection's rebuild trigger (`rebuild-busy.ts`): every busy day
 * either side of an appointment write touches is recomputed, in its own
 * transaction, from the LIVE appointments that occupy it — `Set` when
 * something does, `Delete` when nothing does. The plan that reached the
 * commit is asserted whole; the geometry itself is `BusySystem`'s spec.
 */

const IVAN = FIXTURE_IDS.barber;
const TOMORROW = localDate('2026-09-29');
const TODAY_KEY = BusyKey.of(IVAN, FIXTURE_TODAY);
const TOMORROW_KEY = BusyKey.of(IVAN, TOMORROW);

/** A stored document's body — the entity minus its id (Law 5). */
function bodyOf(entity: { readonly id: string }): DocBody {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const LONDON = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/London');
  if (!zone.ok) throw new Error('a broken fixture zone');
  return zone.value;
})();
const NORTH = LocationId.of('loc-north');

/**
 * The shops the zone is read from (Law 7.2): the fixture shop — the
 * deployment's default location, on `FIXTURE_TIME_ZONE` — and a second shop
 * on London's clock.
 */
const ZONE_PORTS = {
  ...memoryLocationLoadPorts(
    memoryProgramsWorld({
      locations: [
        locationFixture(),
        locationFixture({ id: NORTH, timeZone: LONDON }),
      ],
    }),
  ),
  ...memoryDefaultLocationPorts(),
};

function rig(appointments: readonly Appointment[]) {
  const store = memoryStore(
    appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
  );
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const run = rebuildBusy({ ...tx, ...telemetry, ...ZONE_PORTS });
  return { store, tx, telemetry, run };
}

const dayStart = (day: LocalDate) =>
  ZonedTimeSystem.startOfLocalDay(day, FIXTURE_TIME_ZONE);

/** A busy day as the rebuild writes it: the entity minus its id. */
function busyBody(day: LocalDate, blocks: readonly MinuteBlock[]): DocBody {
  return {
    barberId: IVAN,
    localDate: day,
    utcEpochMs: dayStart(day),
    blocks,
  };
}

const block = (from: number, to: number) =>
  MinuteBlock.of(minute(from), endMinute(to), BlockKind.Busy);

/** The fixture visit moved to tomorrow at 11:00. */
function onTomorrow(id: string): Appointment {
  const seat = seatFixture({ startMinutes: minute(660) });
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: TOMORROW,
    startMinutes: minute(660),
    endMinutes: endMinute(690),
    seats: [seat],
    busyKeys: [TOMORROW_KEY],
  });
}

/** A command with no refused side — nothing salvaged, no refusal (edge-hardening D-3). */
const NOTHING_SALVAGED = {
  salvagedKeys: [],
  salvagedLocationId: null,
  refusal: null,
} as const;

/** The refusal a malformed side of the fixture visit carries (edge-hardening D-3). */
const REFUSED_SIDE = RepositoryError.malformed(
  `${Collections.Appointments}/${FIXTURE_IDS.appointment}`,
  'seats[0].startMinutes',
);

/** An answer nothing failed in. */
const NO_FAILURE = { failures: [], attemptFailure: null } as const;

describe('rebuildBusy', () => {
  it('rebuilds the day a new visit occupies from the live appointments, in one plan per day', async () => {
    const booked = appointmentFixture();
    const { tx, run } = rig([booked]);
    const answer = await run({
      before: null,
      after: booked,
      ...NOTHING_SALVAGED,
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [TODAY_KEY], ...NO_FAILURE },
    });
    expect(tx.plans).toEqual([
      [
        WriteOp.set(
          [Collections.BarberBusy, TODAY_KEY],
          busyBody(FIXTURE_TODAY, [block(600, 630)]),
        ),
      ],
    ]);
  });

  it('reads the day as `busyKeys array-contains ∧ bookingStatus in [PENDING, CONFIRMED]` (index #7)', async () => {
    const booked = appointmentFixture();
    const { tx, run } = rig([booked]);
    await run({ before: null, after: booked, ...NOTHING_SALVAGED });
    expect(tx.transactions[0]?.queries).toEqual([liveOnBusyDay(TODAY_KEY)]);
    expect(liveOnBusyDay(TODAY_KEY)).toEqual({
      collection: [Collections.Appointments],
      where: [
        { field: 'busyKeys', op: QueryOp.ArrayContains, value: TODAY_KEY },
        {
          field: 'bookingStatus',
          op: QueryOp.In,
          value: [BookingStatus.Pending, BookingStatus.Confirmed],
        },
      ],
      orderBy: [],
      limit: null,
    });
  });

  it('deletes the day a cancellation emptied — never an empty document', async () => {
    const booked = appointmentFixture();
    const cancelled = appointmentFixture({
      lifecycle: BookingLifecycle.cancel(
        FIXTURE_NOW_UTC_MS,
        CancellationReasonSet.of([CancellationReason.ClientUnwell]),
      ),
    });
    const { tx, run } = rig([cancelled]);
    await run({
      before: booked,
      after: cancelled,
      ...NOTHING_SALVAGED,
    });
    expect(tx.plans).toEqual([
      [WriteOp.remove([Collections.BarberBusy, TODAY_KEY])],
    ]);
  });

  it('frees the old day and fills the new one on a move to another day, in key order', async () => {
    const booked = appointmentFixture();
    const moved = onTomorrow(FIXTURE_IDS.appointment);
    const { tx, run } = rig([moved]);
    const answer = await run({
      before: booked,
      after: moved,
      ...NOTHING_SALVAGED,
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [TODAY_KEY, TOMORROW_KEY], ...NO_FAILURE },
    });
    expect(tx.plans).toEqual([
      [WriteOp.remove([Collections.BarberBusy, TODAY_KEY])],
      [
        WriteOp.set(
          [Collections.BarberBusy, TOMORROW_KEY],
          busyBody(TOMORROW, [block(660, 690)]),
        ),
      ],
    ]);
  });

  it('merges back-to-back visits into one block — density, never count — and counts a pending visit as live', async () => {
    const first = appointmentFixture();
    const second = appointmentFixture({
      id: AppointmentId.of('appt-2'),
      seats: [seatFixture({ startMinutes: minute(630) })],
      startMinutes: minute(630),
      endMinutes: endMinute(660),
      lifecycle: BookingLifecycle.pending(FIXTURE_NOW_UTC_MS),
    });
    const { tx, run } = rig([first, second]);
    await run({ before: null, after: second, ...NOTHING_SALVAGED });
    expect(tx.plans).toEqual([
      [
        WriteOp.set(
          [Collections.BarberBusy, TODAY_KEY],
          busyBody(FIXTURE_TODAY, [block(600, 660)]),
        ),
      ],
    ]);
  });

  it('writes nothing when neither side occupies a day', async () => {
    const { tx, run } = rig([]);
    const answer = await run({
      before: null,
      after: null,
      ...NOTHING_SALVAGED,
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [], ...NO_FAILURE },
    });
    expect(tx.transactions).toEqual([]);
  });

  it('stamps a busy day’s first instant on the zone of the written visit’s shop (Law 7.2)', async () => {
    const booked = appointmentFixture({ locationId: NORTH });
    const { tx, run } = rig([booked]);
    await run({ before: null, after: booked, ...NOTHING_SALVAGED });
    expect(tx.plans).toEqual([
      [
        WriteOp.set([Collections.BarberBusy, TODAY_KEY], {
          ...busyBody(FIXTURE_TODAY, [block(600, 630)]),
          utcEpochMs: ZonedTimeSystem.startOfLocalDay(FIXTURE_TODAY, LONDON),
        }),
      ],
    ]);
  });

  it('answers a zone it cannot read as its store failure, rebuilding nothing (4A-2 (e))', async () => {
    const booked = appointmentFixture();
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const tx = memoryTxPorts(memoryStore([]));
    const run = rebuildBusy({
      ...tx,
      ...recordingTelemetry(),
      ...memoryDefaultLocationPorts(),
      loadLocation: async () => Result.err(failed),
    });
    expect(
      await run({ before: null, after: booked, ...NOTHING_SALVAGED }),
    ).toEqual(Result.err(failed));
    expect(tx.transactions).toEqual([]);
  });

  it('logs a failed day, still rebuilds the next one, and answers the verdict over the failures (edge-hardening DEP-5)', async () => {
    const booked = appointmentFixture();
    const telemetry = recordingTelemetry();
    const outage = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const run = rebuildBusy({
      ...telemetry,
      ...ZONE_PORTS,
      commit: async () => {
        throw outage;
      },
    });
    expect(
      await run({ before: null, after: booked, ...NOTHING_SALVAGED }),
    ).toEqual({
      ok: true,
      value: {
        rebuiltKeys: [],
        failures: [outage],
        attemptFailure: {
          error: outage,
          failureCode: 'unavailable',
          attemptOutcome: AttemptOutcome.Transient,
        },
      },
    });
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'barberBusy rebuild failed',
        fields: { key: TODAY_KEY, error: outage },
      },
    ]);
  });
});

describe('rebuildBusy — retried (edge-hardening D-5)', () => {
  /** A move from today to tomorrow: two days, two transactions, in key order. */
  function moveRig(
    firstDay: (
      attempt: number,
    ) => Promise<Result<never, RepositoryError>> | null,
  ) {
    const booked = appointmentFixture();
    const moved = onTomorrow(FIXTURE_IDS.appointment);
    const store = memoryStore([
      { path: [Collections.Appointments, moved.id], body: bodyOf(moved) },
    ]);
    const tx = memoryTxPorts(store);
    const telemetry = recordingTelemetry();
    let attempt = 0;
    const run = rebuildBusy({
      ...tx,
      ...telemetry,
      ...ZONE_PORTS,
      commit: (read, decide) => {
        attempt += 1;
        return firstDay(attempt) ?? tx.commit(read, decide);
      },
    });
    const cmd = { before: booked, after: moved, ...NOTHING_SALVAGED };
    return { store, tx, telemetry, run: () => run(cmd) };
  }

  it('rejects nothing on a contended day: the failure is logged and collected, the next day rebuilt, the verdict TRANSIENT', async () => {
    const aborted = Object.assign(new Error('10 ABORTED'), { code: 10 });
    const { tx, telemetry, run } = moveRig((attempt) =>
      attempt === 1 ? Promise.reject(aborted) : null,
    );
    expect(await run()).toEqual({
      ok: true,
      value: {
        rebuiltKeys: [TOMORROW_KEY],
        failures: [aborted],
        attemptFailure: {
          error: aborted,
          failureCode: 'aborted',
          attemptOutcome: AttemptOutcome.Transient,
        },
      },
    });
    expect(tx.plans).toEqual([
      [
        WriteOp.set(
          [Collections.BarberBusy, TOMORROW_KEY],
          busyBody(TOMORROW, [block(660, 690)]),
        ),
      ],
    ]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'barberBusy rebuild failed',
        fields: { key: TODAY_KEY, error: aborted },
      },
    ]);
  });

  it('answers a day whose transaction read a malformed appointment as PERMANENT (data-loss), and still rebuilds the next day', async () => {
    const malformed = RepositoryError.malformed(
      `${Collections.Appointments}/a-broken`,
      'seats[0].startMinutes',
    );
    const { tx, telemetry, run } = moveRig((attempt) =>
      attempt === 1 ? Promise.resolve(Result.err(malformed)) : null,
    );
    expect(await run()).toEqual({
      ok: true,
      value: {
        rebuiltKeys: [TOMORROW_KEY],
        failures: [malformed],
        attemptFailure: {
          error: malformed,
          failureCode: 'data-loss',
          attemptOutcome: AttemptOutcome.Permanent,
        },
      },
    });
    expect(tx.plans).toHaveLength(1);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'barberBusy rebuild failed',
        fields: { key: TODAY_KEY, error: malformed },
      },
    ]);
  });

  it('is idempotent: the same event run twice writes the identical plans and leaves the identical store — the body set and the emptied day deleted', async () => {
    const booked = appointmentFixture();
    const moved = onTomorrow(FIXTURE_IDS.appointment);
    const stale = busyBody(FIXTURE_TODAY, [block(600, 630)]);
    const { store, tx, run } = rig([moved]);
    store.set(`${Collections.BarberBusy}/${TODAY_KEY}`, stale);
    const cmd = { before: booked, after: moved, ...NOTHING_SALVAGED };
    const first = await run(cmd);
    const afterFirst = new Map(store);
    const second = await run(cmd);
    expect(second).toEqual(first);
    expect(tx.plans).toHaveLength(4);
    expect(tx.plans.slice(2)).toEqual(tx.plans.slice(0, 2));
    expect(tx.plans.slice(0, 2)).toEqual([
      [WriteOp.remove([Collections.BarberBusy, TODAY_KEY])],
      [
        WriteOp.set(
          [Collections.BarberBusy, TOMORROW_KEY],
          busyBody(TOMORROW, [block(660, 690)]),
        ),
      ],
    ]);
    expect(store).toEqual(afterFirst);
    expect(store.has(`${Collections.BarberBusy}/${TODAY_KEY}`)).toBe(false);
    expect(store.get(`${Collections.BarberBusy}/${TOMORROW_KEY}`)).toEqual(
      busyBody(TOMORROW, [block(660, 690)]),
    );
  });
});

describe('rebuildBusy — a refused side’s salvage (edge-hardening D-3)', () => {
  it('frees the day a deleted malformed visit held: no side admitted, its salvaged key rebuilt on its salvaged location’s zone', async () => {
    const other = appointmentFixture({
      id: AppointmentId.of('appt-other'),
      locationId: NORTH,
      seats: [seatFixture({ startMinutes: minute(720) })],
      startMinutes: minute(720),
      endMinutes: endMinute(750),
    });
    const { tx, run } = rig([other]);
    const answer = await run({
      before: null,
      after: null,
      salvagedKeys: [TODAY_KEY],
      salvagedLocationId: NORTH,
      refusal: REFUSED_SIDE,
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [TODAY_KEY], ...NO_FAILURE },
    });
    expect(tx.transactions[0]?.queries).toEqual([liveOnBusyDay(TODAY_KEY)]);
    expect(tx.plans).toEqual([
      [
        WriteOp.set([Collections.BarberBusy, TODAY_KEY], {
          ...busyBody(FIXTURE_TODAY, [block(720, 750)]),
          utcEpochMs: ZonedTimeSystem.startOfLocalDay(FIXTURE_TODAY, LONDON),
        }),
      ],
    ]);
  });

  it('deletes the salvaged day when nothing live is left on it', async () => {
    const { tx, run } = rig([]);
    await run({
      before: null,
      after: null,
      salvagedKeys: [TODAY_KEY],
      salvagedLocationId: FIXTURE_IDS.location,
      refusal: REFUSED_SIDE,
    });
    expect(tx.plans).toEqual([
      [WriteOp.remove([Collections.BarberBusy, TODAY_KEY])],
    ]);
  });

  it('rebuilds a refused before’s day beside the admitted after’s, on the admitted side’s zone', async () => {
    const moved = onTomorrow(FIXTURE_IDS.appointment);
    const { tx, run } = rig([moved]);
    const answer = await run({
      before: null,
      after: moved,
      salvagedKeys: [TODAY_KEY],
      salvagedLocationId: NORTH,
      refusal: REFUSED_SIDE,
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [TODAY_KEY, TOMORROW_KEY], ...NO_FAILURE },
    });
    expect(tx.plans).toEqual([
      [WriteOp.remove([Collections.BarberBusy, TODAY_KEY])],
      [
        WriteOp.set(
          [Collections.BarberBusy, TOMORROW_KEY],
          busyBody(TOMORROW, [block(660, 690)]),
        ),
      ],
    ]);
  });

  it('answers the refusal — permanent, nothing read, nothing written — only when the sides leave no day to rebuild', async () => {
    const { tx, telemetry, run } = rig([]);
    const answer = await run({
      before: null,
      after: null,
      salvagedKeys: [],
      salvagedLocationId: FIXTURE_IDS.location,
      refusal: REFUSED_SIDE,
    });
    expect(answer).toEqual(Result.err(REFUSED_SIDE));
    expect(tx.transactions).toEqual([]);
    expect(tx.plans).toEqual([]);
    expect(telemetry.lines).toEqual([]);
  });

  it('never answers the refusal while a day is left: an admitted side’s key drives the rebuild beside it', async () => {
    const booked = appointmentFixture();
    const { tx, run } = rig([booked]);
    const answer = await run({
      before: null,
      after: booked,
      salvagedKeys: [],
      salvagedLocationId: null,
      refusal: REFUSED_SIDE,
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [TODAY_KEY], ...NO_FAILURE },
    });
    expect(tx.plans).toHaveLength(1);
  });
});
