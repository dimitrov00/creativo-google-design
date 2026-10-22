import { describe, expect, it } from 'vitest';
import {
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
  RepositoryError,
  Result,
} from '@core/primitives';
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

describe('rebuildBusy', () => {
  it('rebuilds the day a new visit occupies from the live appointments, in one plan per day', async () => {
    const booked = appointmentFixture();
    const { tx, run } = rig([booked]);
    const answer = await run({
      before: null,
      after: booked,
    });
    expect(answer).toEqual({ ok: true, value: { rebuiltKeys: [TODAY_KEY] } });
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
    await run({ before: null, after: booked });
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
    });
    expect(answer).toEqual({
      ok: true,
      value: { rebuiltKeys: [TODAY_KEY, TOMORROW_KEY] },
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
    await run({ before: null, after: second });
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
    });
    expect(answer).toEqual({ ok: true, value: { rebuiltKeys: [] } });
    expect(tx.transactions).toEqual([]);
  });

  it('stamps a busy day’s first instant on the zone of the written visit’s shop (Law 7.2)', async () => {
    const booked = appointmentFixture({ locationId: NORTH });
    const { tx, run } = rig([booked]);
    await run({ before: null, after: booked });
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
    expect(await run({ before: null, after: booked })).toEqual(
      Result.err(failed),
    );
    expect(tx.transactions).toEqual([]);
  });

  it('logs a failed day and lets the failure go on to the edge', async () => {
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
    await expect(run({ before: null, after: booked })).rejects.toBe(outage);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'barberBusy rebuild failed',
        fields: { key: TODAY_KEY, error: outage },
      },
    ]);
  });
});
