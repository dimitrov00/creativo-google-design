import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  BusyKey,
  CustomerId,
  RepositoryErrorCode,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { localDate, utcMs } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { appointmentReadPorts } = await import('./appointments.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

const IVAN_MONDAY = BusyKey.of(BarberId.of('ivan'), localDate('2026-10-12'));
const GEORGI = CustomerId.of('cus_georgi');
const MARTIN = CustomerId.of('cus_martin');

/** The query keys of a visit — enough of the stored body for every query here. */
function visit(fields: {
  readonly at: string;
  readonly owner?: string;
  readonly subjects?: readonly CustomerId[];
  readonly status?: BookingStatus;
  readonly busyKeys?: readonly string[];
}) {
  return {
    ownerUserId: fields.owner ?? 'u-georgi',
    subjectCustomerIds: fields.subjects ?? [GEORGI],
    busyKeys: fields.busyKeys ?? [],
    bookingStatus: fields.status ?? BookingStatus.Confirmed,
    utcEpochMs: utcMs(fields.at),
  };
}

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

const idsOf = (answer: Result<readonly { readonly id: string }[], unknown>) =>
  answer.ok ? answer.value.map((appointment) => appointment.id) : answer;

describe('appointmentReadPorts.observeAppointment', () => {
  it('reads one visit as its entity, and null when there is none', () => {
    const body = visit({ at: '2026-10-12T10:00:00+03:00' });
    const fake = new FakeFirestore({ 'appointments/a1': body });
    const ports = appointmentReadPorts(asDb(fake));

    const found = recorded(ports.observeAppointment(AppointmentId.of('a1')));
    const absent = recorded(ports.observeAppointment(AppointmentId.of('a2')));

    expect(found.seen).toEqual([Result.ok({ id: 'a1', ...body })]);
    expect(absent.seen).toEqual([Result.ok(null)]);
  });
});

describe('appointmentReadPorts.observeBarberDay — the staff day sheet', () => {
  it('asks by the busyKeys mirror alone and answers every status, by start', () => {
    const fake = new FakeFirestore({
      'appointments/late': visit({
        at: '2026-10-12T15:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
      'appointments/early': visit({
        at: '2026-10-12T09:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
        status: BookingStatus.Cancelled,
      }),
      'appointments/other-chair': visit({
        at: '2026-10-12T11:00:00+03:00',
        busyKeys: ['niko__2026-10-12'],
      }),
    });

    const day = recorded(
      appointmentReadPorts(asDb(fake)).observeBarberDay(IVAN_MONDAY),
    );

    expect(day.seen.map(idsOf)).toEqual([['early', 'late']]);
    expect(fake.reads).toEqual([
      {
        kind: 'listen',
        path: 'appointments',
        constraints: [`busyKeys array-contains "${IVAN_MONDAY}"`],
      },
    ]);
  });

  it('follows the day: a booking made after the first snapshot joins it', () => {
    const fake = new FakeFirestore();
    const day = recorded(
      appointmentReadPorts(asDb(fake)).observeBarberDay(IVAN_MONDAY),
    );

    fake.set(
      'appointments/a1',
      visit({ at: '2026-10-12T10:00:00+03:00', busyKeys: [IVAN_MONDAY] }),
    );

    expect(day.seen.map(idsOf)).toEqual([[], ['a1']]);
  });
});

describe('appointmentReadPorts.observeUpcoming and observeHistory — the account’s own', () => {
  const fake = () =>
    new FakeFirestore({
      'appointments/mine-later': visit({ at: '2026-11-02T10:00:00+02:00' }),
      'appointments/mine-sooner': visit({
        at: '2026-10-20T10:00:00+03:00',
        status: BookingStatus.Pending,
      }),
      'appointments/mine-cancelled': visit({
        at: '2026-10-25T10:00:00+03:00',
        status: BookingStatus.Cancelled,
      }),
      'appointments/mine-done': visit({
        at: '2026-09-01T10:00:00+03:00',
        status: BookingStatus.Completed,
      }),
      'appointments/someone-else': visit({
        at: '2026-10-21T10:00:00+03:00',
        owner: 'u-martin',
      }),
    });

  it('answers the live bookings of one account by start — index #6', () => {
    const db = fake();

    const upcoming = recorded(
      appointmentReadPorts(asDb(db)).observeUpcoming(UserId.of('u-georgi')),
    );

    expect(upcoming.seen.map(idsOf)).toEqual([['mine-sooner', 'mine-later']]);
    expect(db.reads[0]?.constraints).toEqual([
      'ownerUserId == "u-georgi"',
      'bookingStatus in ["PENDING","CONFIRMED"]',
      'orderBy utcEpochMs asc',
    ]);
  });

  it('answers the newest visits of one account, newest first and bounded — index #18', () => {
    const db = fake();

    const history = recorded(
      appointmentReadPorts(asDb(db)).observeHistory(UserId.of('u-georgi'), 3),
    );

    expect(history.seen.map(idsOf)).toEqual([
      ['mine-later', 'mine-cancelled', 'mine-sooner'],
    ]);
    expect(db.reads[0]?.constraints).toEqual([
      'ownerUserId == "u-georgi"',
      'orderBy utcEpochMs desc',
      'limit 3',
    ]);
  });
});

describe('appointmentReadPorts.pageClientHistory — the client card, a page at a time', () => {
  const seeded = () =>
    new FakeFirestore({
      'appointments/a-01': visit({ at: '2026-06-02T10:00:00+03:00' }),
      'appointments/a-02': visit({
        at: '2026-07-01T10:00:00+03:00',
        owner: 'u-martin',
        subjects: [MARTIN, GEORGI],
      }),
      'appointments/a-03': visit({ at: '2026-08-05T10:00:00+03:00' }),
      'appointments/a-04': visit({
        at: '2026-09-02T10:00:00+03:00',
        owner: 'u-martin',
        subjects: [MARTIN],
      }),
      'appointments/a-05': visit({ at: '2026-09-28T10:00:00+03:00' }),
    });

  it('reads every visit with a seat for the client — as company too — newest first, one row more than the page', async () => {
    const fake = seeded();

    const page = await appointmentReadPorts(asDb(fake)).pageClientHistory(
      GEORGI,
      null,
      10,
    );

    expect(page.ok && page.value.appointments.map((a) => a.id)).toEqual([
      'a-05',
      'a-03',
      'a-02',
      'a-01',
    ]);
    expect(page.ok && page.value.nextBeforeUtcMs).toBeNull();
    expect(fake.reads[0]?.constraints).toEqual([
      'subjectCustomerIds array-contains "cus_georgi"',
      'orderBy utcEpochMs desc',
      'limit 11',
    ]);
  });

  it('pages on the stored start until nothing older is left', async () => {
    const ports = appointmentReadPorts(asDb(seeded()));

    const first = await ports.pageClientHistory(GEORGI, null, 3);
    if (!first.ok) throw new Error('first page refused');
    expect(first.value.appointments.map((a) => a.id)).toEqual([
      'a-05',
      'a-03',
      'a-02',
    ]);
    expect(first.value.nextBeforeUtcMs).toBe(
      utcMs('2026-07-01T10:00:00+03:00'),
    );

    const next = await ports.pageClientHistory(
      GEORGI,
      first.value.nextBeforeUtcMs,
      3,
    );
    expect(next.ok && next.value.appointments.map((a) => a.id)).toEqual([
      'a-01',
    ]);
    expect(next.ok && next.value.nextBeforeUtcMs).toBeNull();
  });

  it('keeps visits starting at the same instant on one page, and says when nothing is older', async () => {
    const fake = seeded().set(
      'appointments/a-05b',
      visit({ at: '2026-09-28T10:00:00+03:00' }),
    );
    const ports = appointmentReadPorts(asDb(fake));

    const page = await ports.pageClientHistory(GEORGI, null, 1);
    if (!page.ok) throw new Error('page refused');
    expect(page.value.appointments.map((a) => a.id)).toEqual(['a-05b', 'a-05']);
    const rest = await ports.pageClientHistory(
      GEORGI,
      page.value.nextBeforeUtcMs,
      5,
    );
    expect(rest.ok && rest.value.appointments.map((a) => a.id)).toEqual([
      'a-03',
      'a-02',
      'a-01',
    ]);

    const only = new FakeFirestore({
      'appointments/b-01': visit({ at: '2026-09-28T10:00:00+03:00' }),
      'appointments/b-02': visit({ at: '2026-09-28T10:00:00+03:00' }),
    });
    const whole = await appointmentReadPorts(asDb(only)).pageClientHistory(
      GEORGI,
      null,
      1,
    );
    expect(whole.ok && whole.value.appointments).toHaveLength(2);
    expect(whole.ok && whole.value.nextBeforeUtcMs).toBeNull();
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = seeded().failWith({ code: 'permission-denied' });

    const page = await appointmentReadPorts(asDb(fake)).pageClientHistory(
      GEORGI,
      null,
      5,
    );

    expect(page).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'appointments',
        reason: 'permission-denied',
      }),
    );
  });
});

describe('appointmentReadPorts.searchAppointmentWindow — the staff search pool', () => {
  const NOW: UtcEpochMs = utcMs('2026-10-12T12:00:00+03:00');
  const seeded = () =>
    new FakeFirestore({
      'appointments/p3': visit({ at: '2026-10-09T10:00:00+03:00' }),
      'appointments/p2': visit({ at: '2026-10-10T10:00:00+03:00' }),
      'appointments/p1': visit({ at: '2026-10-12T11:59:00+03:00' }),
      'appointments/n1': visit({ at: '2026-10-12T12:00:00+03:00' }),
      'appointments/n2': visit({ at: '2026-10-14T10:00:00+03:00' }),
      'appointments/n3': visit({ at: '2026-10-15T10:00:00+03:00' }),
    });

  it('reads two halves outward from now on utcEpochMs alone, each cut at the limit, and answers them by start', async () => {
    const fake = seeded();

    const pool = await appointmentReadPorts(asDb(fake)).searchAppointmentWindow(
      NOW,
      2,
    );

    expect(idsOf(pool)).toEqual(['p2', 'p1', 'n1', 'n2']);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      [`utcEpochMs < ${NOW}`, 'orderBy utcEpochMs desc', 'limit 2'],
      [`utcEpochMs >= ${NOW}`, 'orderBy utcEpochMs asc', 'limit 2'],
    ]);
  });

  it('answers whatever there is when a side runs short', async () => {
    const pool = await appointmentReadPorts(
      asDb(seeded()),
    ).searchAppointmentWindow(NOW, 10);

    expect(idsOf(pool)).toEqual(['p3', 'p2', 'p1', 'n1', 'n2', 'n3']);
  });

  it('turns a refused read — or a limit no query takes — into a failed Result', async () => {
    const refused = await appointmentReadPorts(
      asDb(seeded().failWith({ code: 'permission-denied' })),
    ).searchAppointmentWindow(NOW, 2);
    const nonsense = await appointmentReadPorts(
      asDb(seeded()),
    ).searchAppointmentWindow(NOW, 0);

    expect(refused.ok).toBe(false);
    expect(nonsense.ok).toBe(false);
  });
});
