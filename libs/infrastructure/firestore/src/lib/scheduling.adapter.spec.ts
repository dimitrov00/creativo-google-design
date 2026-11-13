import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { BookingPolicy, MinuteRange } from '@core/components';
import {
  BarberId,
  BusyKey,
  MonthKey,
  ExceptionEffect,
  LocationId,
  Result,
  ScheduleExceptionId,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { ScheduleException } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  at,
  barberBusyDayFixture,
  localDate,
  recordingTelemetry,
  schedulingPortsContract,
  until,
  utcMs,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';
import { UNGUARDED } from '../testing/unguarded';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { schedulingReadPorts } = await import('./scheduling.adapter');
const { guardedReads } = await import('./observe');

const IVAN = BarberId.of('ivan');
const MONDAY = BusyKey.of(IVAN, localDate('2026-10-12'));
const TUESDAY = BusyKey.of(IVAN, localDate('2026-10-13'));

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

/** One barber's day with `ranges` blocked out (10:00-11:00 unless told). */
function blocked(
  key: BusyKey,
  ranges: readonly MinuteRange[] = [MinuteRange.of(at(10), until(11))],
): ScheduleException {
  const { localDate: day } = BusyKey.split(key);
  return {
    id: ScheduleExceptionId.of(key),
    barberId: IVAN,
    localDate: day,
    utcEpochMs: utcMs(`${day}T00:00:00+03:00`),
    locationId: LocationId.of('loc-center'),
    exceptionEffect: ExceptionEffect.Blocked,
    exceptionRanges: ranges,
    dayBreakRanges: null,
  };
}

/** The stored body: the entity minus its id. */
function bodyOf(exception: ScheduleException): object {
  const { id, ...body } = exception;
  expect(id).toBeTruthy();
  return body;
}

describe('schedulingReadPorts — one document each, live, the body the entity', () => {
  it('reads one barber’s busy day by its BusyKey, and null while nothing is booked', () => {
    const blocks = [{ startMinutes: 600, endMinutes: 645 }];
    const fake = new FakeFirestore({
      [`barberBusy/${MONDAY}`]: {
        barberId: 'ivan',
        localDate: '2026-10-12',
        utcEpochMs: 1,
        blocks,
      },
    });
    const ports = schedulingReadPorts(asDb(fake), UNGUARDED);

    const monday = recorded(ports.observeBusyDay(MONDAY));
    const tuesday = recorded(ports.observeBusyDay(TUESDAY));

    expect(monday.seen).toEqual([
      Result.ok({
        id: MONDAY,
        barberId: 'ivan',
        localDate: '2026-10-12',
        utcEpochMs: 1,
        blocks,
      }),
    ]);
    expect(tuesday.seen).toEqual([Result.ok(null)]);
    expect(fake.reads.map((read) => read.path)).toEqual([
      `barberBusy/${MONDAY}`,
      `barberBusy/${TUESDAY}`,
    ]);
  });

  it('reads the exception, the roster, the shop and the capacity month at their own paths', () => {
    const fake = new FakeFirestore({
      [`scheduleExceptions/${MONDAY}`]: bodyOf(blocked(MONDAY)),
      'barberSchedules/ivan': { turnaroundMinutes: 5, versions: [] },
      'locations/loc-center': { timeZone: 'Europe/Sofia' },
      'capacity/2026-10': { month: '2026-10', entries: [] },
    });
    const ports = schedulingReadPorts(asDb(fake), UNGUARDED);

    const exception = recorded(ports.observeExceptions(MONDAY));
    const schedule = recorded(ports.observeSchedule(IVAN));
    const shop = recorded(ports.observeLocation(LocationId.of('loc-center')));
    const month = recorded(ports.observeCapacityMonth(MonthKey.of('2026-10')));

    expect(exception.seen).toEqual([Result.ok(blocked(MONDAY))]);
    expect(schedule.seen).toEqual([
      Result.ok({ id: 'ivan', turnaroundMinutes: 5, versions: [] }),
    ]);
    expect(shop.seen).toEqual([
      Result.ok({ id: 'loc-center', timeZone: 'Europe/Sofia' }),
    ]);
    expect(month.seen).toEqual([
      Result.ok({ id: '2026-10', month: '2026-10', entries: [] }),
    ]);
    expect(fake.reads.map((read) => read.path)).toEqual([
      `scheduleExceptions/${MONDAY}`,
      'barberSchedules/ivan',
      'locations/loc-center',
      'capacity/2026-10',
    ]);
  });

  it('follows a day as it changes — a block added after the first snapshot', () => {
    const fake = new FakeFirestore();
    const exception = recorded(
      schedulingReadPorts(asDb(fake), UNGUARDED).observeExceptions(MONDAY),
    );

    fake.set(`scheduleExceptions/${MONDAY}`, bodyOf(blocked(MONDAY)));

    expect(exception.seen).toEqual([
      Result.ok(null),
      Result.ok(blocked(MONDAY)),
    ]);
  });

  it('answers a refused read as the port’s RepositoryError', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const busy = recorded(
      schedulingReadPorts(asDb(fake), UNGUARDED).observeBusyDay(MONDAY),
    );

    expect(busy.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: `barberBusy/${MONDAY}`,
        reason: 'permission-denied',
      }),
    ]);
  });
});

/*
 * The scheduling ports' busy contract (`@core/testing`), run over the
 * browser bundle's raw stream: a barber's `busy` is the stored blocks, the
 * handed-back chairs released first, then padded — derived by the caller
 * (`AvailabilitySystem.paddedBusy`), never by this adapter. The successor
 * of `FirestoreAvailabilityReader`'s `availabilityReaderBusyCases` runner.
 */
describe('schedulingReadPorts.observeBusyDay — the scheduling ports’ busy contract', () => {
  const contract = schedulingPortsContract({
    localDate: FIXTURE_TODAY,
    timeZone: FIXTURE_TIME_ZONE,
    barberId: IVAN,
    otherBarberId: BarberId.of('niko'),
  });

  it.each(contract.cases.map((entry) => [entry.name, entry] as const))(
    '%s',
    async (_name, entry) => {
      const { id, ...body } = entry.stored;
      const fake = new FakeFirestore({ [`barberBusy/${id}`]: body });

      expect(
        await contract.busyThroughObserve(
          schedulingReadPorts(asDb(fake), UNGUARDED).observeBusyDay,
          entry,
        ),
      ).toEqual(entry.busy);
    },
  );
});

describe('schedulingReadPorts.observePolicy — the defaults are the floor', () => {
  it('starts on the defaults, and a tenant with no policy document stays on them', () => {
    const fake = new FakeFirestore();

    const policy = recorded(
      schedulingReadPorts(asDb(fake), UNGUARDED).observePolicy(),
    );

    expect(policy.seen).toEqual([Result.ok(BookingPolicy.DEFAULT)]);
    expect(fake.reads.map((read) => read.path)).toEqual([
      'settings/bookingPolicy',
    ]);
  });

  it('reads a partial document over the defaults, field by field', () => {
    const fake = new FakeFirestore({
      'settings/bookingPolicy': { horizonMonths: 6, minLeadMinutes: 'soon' },
    });

    const policy = recorded(
      schedulingReadPorts(asDb(fake), UNGUARDED).observePolicy(),
    );

    expect(policy.seen).toEqual([
      Result.ok(BookingPolicy.DEFAULT),
      Result.ok({ ...BookingPolicy.DEFAULT, horizonMonths: 6 }),
    ]);
  });

  it('emits only when the policy changes — a document that says the defaults re-bills nothing', () => {
    const fake = new FakeFirestore({
      'settings/bookingPolicy': { ...BookingPolicy.DEFAULT },
    });
    const policy = recorded(
      schedulingReadPorts(asDb(fake), UNGUARDED).observePolicy(),
    );

    fake.set('settings/bookingPolicy', { ...BookingPolicy.DEFAULT });
    fake.set('settings/bookingPolicy', {
      ...BookingPolicy.DEFAULT,
      autoConfirm: !BookingPolicy.DEFAULT.autoConfirm,
    });

    expect(policy.seen).toEqual([
      Result.ok(BookingPolicy.DEFAULT),
      Result.ok({
        ...BookingPolicy.DEFAULT,
        autoConfirm: !BookingPolicy.DEFAULT.autoConfirm,
      }),
    ]);
  });

  it('surfaces a refused read after the defaults, for the store to keep them', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const policy = recorded(
      schedulingReadPorts(asDb(fake), UNGUARDED).observePolicy(),
    );

    expect(policy.seen).toEqual([
      Result.ok(BookingPolicy.DEFAULT),
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'settings/bookingPolicy',
        reason: 'permission-denied',
      }),
    ]);
  });
});

describe('schedulingReadPorts.observeBusyDay, guarded — the SINGLE rule, fail-closed (edge hardening D-3)', () => {
  it('emits REPOSITORY_MALFORMED for a malformed busy day, keeps listening, and emits ok once it is fixed', () => {
    const day = barberBusyDayFixture();
    const path = `barberBusy/${day.id}`;
    const body = Object.fromEntries(
      Object.entries(day).filter(([key]) => key !== 'id'),
    );
    const fake = new FakeFirestore({
      [path]: { ...body, blocks: [{ startMinutes: 660, endMinutes: 600 }] },
    });
    const telemetry = recordingTelemetry();
    const live = recorded(
      schedulingReadPorts(asDb(fake), guardedReads(telemetry)).observeBusyDay(
        BusyKey.of(day.barberId, day.localDate),
      ),
    );

    fake.set(path, body);

    expect(live.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.Malformed,
        path,
        reason: 'blocks[0].endMinutes',
      }),
      Result.ok(day),
    ]);
    expect(telemetry.lines.map((line) => line.fields)).toEqual([
      { path, field: 'blocks[0].endMinutes' },
    ]);
    expect(fake.listening).toBe(1);
    live.stop();
  });

  it('reads the other five members as stored — the guard is the busy day’s alone', () => {
    const fake = new FakeFirestore({
      'barberSchedules/ivan': { odd: true },
    });
    const telemetry = recordingTelemetry();
    const roster = recorded(
      schedulingReadPorts(asDb(fake), guardedReads(telemetry)).observeSchedule(
        IVAN,
      ),
    );
    expect(roster.seen).toEqual([Result.ok({ id: 'ivan', odd: true })]);
    expect(telemetry.lines).toEqual([]);
  });
});
