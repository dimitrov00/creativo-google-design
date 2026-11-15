import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { BookingLifecycle } from '@core/components';
import {
  AppointmentId,
  BarberBusyDayId,
  BarberId,
  BusyKey,
  Result,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { Appointment, BarberBusyDay } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  barberBusyDayFixture,
  bodyOf,
  localDate,
  recordingTelemetry,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { barberAheadPorts } = await import('./barber-ahead.adapter');
const { guardedReads } = await import('./observe');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');

/** A stored busy day of `barberId` on `day`. */
const busy = (barberId: BarberId, day: string): BarberBusyDay =>
  barberBusyDayFixture({
    id: BarberBusyDayId.of(BusyKey.of(barberId, localDate(day))),
    barberId,
    localDate: localDate(day),
  });
/** A stored visit seating `barberIds` on `day`. */
const visit = (
  id: string,
  day: string,
  barberIds: readonly BarberId[],
  over: Parameters<typeof appointmentFixture>[0] = {},
): Appointment =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    barberIds,
    busyKeys: barberIds.map((barberId) => BusyKey.of(barberId, localDate(day))),
    ...over,
  });
const stored = (rows: readonly { readonly id: string }[], collection: string) =>
  Object.fromEntries(
    rows.map((row) => [`${collection}/${row.id}`, bodyOf(row)]),
  );
const ports = (fake: FakeFirestore) =>
  barberAheadPorts(asDb(fake), guardedReads(recordingTelemetry()));

describe('barberAheadPorts.loadBusyDaysFrom', () => {
  it('answers one barber’s busy days from the day on, oldest first — one query on the projection’s own index', async () => {
    const days = [
      busy(IVAN, '2026-11-15'),
      busy(IVAN, '2026-12-02'),
      busy(IVAN, '2026-11-17'),
      busy(NIKO, '2026-11-17'),
    ];
    const fake = new FakeFirestore(stored(days, 'barberBusy'));

    const answer = await ports(fake).loadBusyDaysFrom(
      IVAN,
      localDate('2026-11-16'),
    );

    expect(answer).toEqual(Result.ok([days[2], days[1]]));
    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'barberBusy',
        constraints: [
          'barberId == "ivan"',
          'localDate >= "2026-11-16"',
          'orderBy localDate asc',
          'limit 400',
        ],
      },
    ]);
  });

  it('answers a refused read as the port’s RepositoryError', async () => {
    const fake = new FakeFirestore({});
    fake.failWith(new Error('unavailable'));
    const answer = await ports(fake).loadBusyDaysFrom(
      IVAN,
      localDate('2026-11-16'),
    );
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });
});

describe('barberAheadPorts.loadBarberDay', () => {
  it('answers every visit on the barber’s day, whatever its status — the day sheet’s own query, read once', async () => {
    const key = BusyKey.of(IVAN, localDate('2026-11-17'));
    const visits = [
      visit('a-1', '2026-11-17', [IVAN]),
      visit('a-2', '2026-11-17', [IVAN, NIKO], {
        lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
      }),
      visit('a-other', '2026-11-17', [NIKO]),
    ];
    const fake = new FakeFirestore(stored(visits, 'appointments'));

    const answer = await ports(fake).loadBarberDay(key);

    expect(answer).toEqual(Result.ok([visits[0], visits[1]]));
    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'appointments',
        constraints: [`busyKeys array-contains "${key}"`],
      },
    ]);
  });

  it('drops a stored visit the guard refuses, and still answers the rest', async () => {
    const key = BusyKey.of(IVAN, localDate('2026-11-17'));
    const good = visit('a-1', '2026-11-17', [IVAN]);
    const fake = new FakeFirestore({
      ...stored([good], 'appointments'),
      'appointments/a-broken': {
        ...bodyOf(visit('a-broken', '2026-11-17', [IVAN])),
        startMinutes: 'nine',
      },
    });

    expect(await ports(fake).loadBarberDay(key)).toEqual(Result.ok([good]));
  });
});
