import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  BusyKey,
  CustomerId,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { BookingLifecycle, CancellationReasonSet } from '@core/components';
import {
  appointmentFixture,
  localDate,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';
import { UNGUARDED } from '../testing/unguarded';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { appointmentReadPorts } = await import('./appointments.adapter');
const { guardedReads } = await import('./observe');

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

/** A staff day's answer as its visits' ids and the count it could not read (OR-2). */
const dayOf = (
  answer: Result<
    {
      readonly appointments: readonly { readonly id: string }[];
      readonly unreadableCount: number;
    },
    unknown
  >,
) =>
  answer.ok
    ? {
        ids: answer.value.appointments.map((appointment) => appointment.id),
        unreadableCount: answer.value.unreadableCount,
      }
    : answer;

describe('appointmentReadPorts.observeAppointment', () => {
  it('reads one visit as its entity, and null when there is none', () => {
    const body = visit({ at: '2026-10-12T10:00:00+03:00' });
    const fake = new FakeFirestore({ 'appointments/a1': body });
    const ports = appointmentReadPorts(asDb(fake), UNGUARDED);

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
      appointmentReadPorts(asDb(fake), UNGUARDED).observeBarberDay(IVAN_MONDAY),
    );

    expect(day.seen.map(dayOf)).toEqual([
      { ids: ['early', 'late'], unreadableCount: 0 },
    ]);
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
      appointmentReadPorts(asDb(fake), UNGUARDED).observeBarberDay(IVAN_MONDAY),
    );

    fake.set(
      'appointments/a1',
      visit({ at: '2026-10-12T10:00:00+03:00', busyKeys: [IVAN_MONDAY] }),
    );

    expect(day.seen.map(dayOf)).toEqual([
      { ids: [], unreadableCount: 0 },
      { ids: ['a1'], unreadableCount: 0 },
    ]);
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
      appointmentReadPorts(asDb(db), UNGUARDED).observeUpcoming(
        UserId.of('u-georgi'),
      ),
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
      appointmentReadPorts(asDb(db), UNGUARDED).observeHistory(
        UserId.of('u-georgi'),
        3,
      ),
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

    const page = await appointmentReadPorts(
      asDb(fake),
      UNGUARDED,
    ).pageClientHistory(GEORGI, null, 10);

    expect(page.ok && page.value.appointments.map((a) => a.id)).toEqual([
      'a-05',
      'a-03',
      'a-02',
      'a-01',
    ]);
    expect(page.ok && page.value.nextBeforeUtcMs).toBeNull();
    expect(fake.reads[0]?.constraints).toEqual([
      'subjectCustomerIds array-contains "cus_georgi"',
      'utcEpochMs <= 253402300799999',
      'orderBy utcEpochMs desc',
      'limit 11',
    ]);
  });

  it('pages on the stored start until nothing older is left', async () => {
    const ports = appointmentReadPorts(asDb(seeded()), UNGUARDED);

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
    const ports = appointmentReadPorts(asDb(fake), UNGUARDED);

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
    const whole = await appointmentReadPorts(
      asDb(only),
      UNGUARDED,
    ).pageClientHistory(GEORGI, null, 1);
    expect(whole.ok && whole.value.appointments).toHaveLength(2);
    expect(whole.ok && whole.value.nextBeforeUtcMs).toBeNull();
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = seeded().failWith({ code: 'permission-denied' });

    const page = await appointmentReadPorts(
      asDb(fake),
      UNGUARDED,
    ).pageClientHistory(GEORGI, null, 5);

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

    const pool = await appointmentReadPorts(
      asDb(fake),
      UNGUARDED,
    ).searchAppointmentWindow(NOW, 2);

    expect(idsOf(pool)).toEqual(['p2', 'p1', 'n1', 'n2']);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      [`utcEpochMs < ${NOW}`, 'orderBy utcEpochMs desc', 'limit 2'],
      [`utcEpochMs >= ${NOW}`, 'orderBy utcEpochMs asc', 'limit 2'],
    ]);
  });

  it('answers whatever there is when a side runs short', async () => {
    const pool = await appointmentReadPorts(
      asDb(seeded()),
      UNGUARDED,
    ).searchAppointmentWindow(NOW, 10);

    expect(idsOf(pool)).toEqual(['p3', 'p2', 'p1', 'n1', 'n2', 'n3']);
  });

  it('turns a refused read — or a limit no query takes — into a failed Result', async () => {
    const refused = await appointmentReadPorts(
      asDb(seeded().failWith({ code: 'permission-denied' })),
      UNGUARDED,
    ).searchAppointmentWindow(NOW, 2);
    const nonsense = await appointmentReadPorts(
      asDb(seeded()),
      UNGUARDED,
    ).searchAppointmentWindow(NOW, 0);

    expect(refused.ok).toBe(false);
    expect(nonsense.ok).toBe(false);
  });
});

describe('appointmentReadPorts, guarded — malformed visits at read time (edge hardening D-3)', () => {
  /** A whole stored visit — every field the guard reads — keyed like {@link visit}. */
  function storedVisit(fields: {
    readonly at: string;
    readonly owner?: string;
    readonly subjects?: readonly CustomerId[];
    readonly status?: BookingStatus;
    readonly busyKeys?: readonly BusyKey[];
  }): Record<string, unknown> {
    const at = utcMs(fields.at);
    const lifecycle =
      fields.status === BookingStatus.Pending
        ? BookingLifecycle.pending(at)
        : fields.status === BookingStatus.Cancelled
          ? BookingLifecycle.cancel(at, CancellationReasonSet.of([]))
          : fields.status === BookingStatus.Completed
            ? BookingLifecycle.complete(at)
            : BookingLifecycle.confirm(at);
    const entity = appointmentFixture({
      ownerUserId: UserId.of(fields.owner ?? 'u-georgi'),
      subjectCustomerIds: fields.subjects ?? [GEORGI],
      busyKeys: fields.busyKeys ?? [],
      utcEpochMs: at,
      lifecycle,
    });
    return Object.fromEntries(
      Object.entries(entity).filter(([key]) => key !== 'id'),
    );
  }

  /** The same visit, broken where every guard looks first after the id. */
  const malformedVisit = (fields: Parameters<typeof storedVisit>[0]) => ({
    ...storedVisit(fields),
    seats: [null],
  });

  const guarded = (fake: FakeFirestore) => {
    const telemetry = recordingTelemetry();
    return {
      lines: telemetry.lines,
      ports: appointmentReadPorts(asDb(fake), guardedReads(telemetry)),
    };
  };

  const malformed = (path: string, reason: string) =>
    Result.err({ errorCode: RepositoryErrorCode.Malformed, path, reason });

  it('observeBarberDay drops a malformed visit, COUNTS it beside the rest by start, and reports it once over two snapshots', () => {
    const fake = new FakeFirestore({
      'appointments/late': storedVisit({
        at: '2026-10-12T15:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
      'appointments/bad': malformedVisit({
        at: '2026-10-12T12:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
      'appointments/early': storedVisit({
        at: '2026-10-12T09:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
    });
    const { lines, ports } = guarded(fake);
    const day = recorded(ports.observeBarberDay(IVAN_MONDAY));

    fake.set(
      'appointments/noon',
      storedVisit({ at: '2026-10-12T13:00:00+03:00', busyKeys: [IVAN_MONDAY] }),
    );

    // OR-2: the dropped visit is counted on every snapshot it is dropped
    // from — the sheet says the chair holds a visit it cannot show.
    expect(day.seen.map(dayOf)).toEqual([
      { ids: ['early', 'late'], unreadableCount: 1 },
      { ids: ['early', 'noon', 'late'], unreadableCount: 1 },
    ]);
    expect(lines).toEqual([
      {
        level: 'error',
        msg: 'malformed document dropped',
        fields: { path: 'appointments/bad', field: 'seats[0]' },
      },
    ]);
  });

  it('observeBarberDay counts each snapshot afresh: a corrected visit joins the day and leaves the count', () => {
    const fake = new FakeFirestore({
      'appointments/bad': malformedVisit({
        at: '2026-10-12T12:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
      'appointments/worse': malformedVisit({
        at: '2026-10-12T14:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
      'appointments/early': storedVisit({
        at: '2026-10-12T09:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
    });
    const day = recorded(guarded(fake).ports.observeBarberDay(IVAN_MONDAY));

    fake.set(
      'appointments/bad',
      storedVisit({ at: '2026-10-12T12:00:00+03:00', busyKeys: [IVAN_MONDAY] }),
    );

    expect(day.seen.map(dayOf)).toEqual([
      { ids: ['early'], unreadableCount: 2 },
      { ids: ['early', 'bad'], unreadableCount: 1 },
    ]);
  });

  it('observeBarberDay whose every visit is malformed emits the refusal — never an empty, free-looking day', () => {
    const fake = new FakeFirestore({
      'appointments/bad': malformedVisit({
        at: '2026-10-12T12:00:00+03:00',
        busyKeys: [IVAN_MONDAY],
      }),
    });
    const day = recorded(guarded(fake).ports.observeBarberDay(IVAN_MONDAY));
    expect(day.seen).toEqual([malformed('appointments/bad', 'seats[0]')]);
  });

  it('observeHistory drops like the day', () => {
    const fake = new FakeFirestore({
      'appointments/new': storedVisit({ at: '2026-11-02T10:00:00+02:00' }),
      'appointments/bad': malformedVisit({ at: '2026-10-25T10:00:00+03:00' }),
      'appointments/old': storedVisit({ at: '2026-09-01T10:00:00+03:00' }),
    });
    const history = recorded(
      guarded(fake).ports.observeHistory(UserId.of('u-georgi'), 5),
    );
    expect(history.seen.map(idsOf)).toEqual([['new', 'old']]);
  });

  it('observeUpcoming is STRICT: one malformed booking among good ones refuses the stream, reported', () => {
    const fake = new FakeFirestore({
      'appointments/soon': storedVisit({ at: '2026-10-20T10:00:00+03:00' }),
      'appointments/bad': malformedVisit({ at: '2026-10-25T10:00:00+03:00' }),
    });
    const { lines, ports } = guarded(fake);
    const upcoming = recorded(ports.observeUpcoming(UserId.of('u-georgi')));
    expect(upcoming.seen).toEqual([malformed('appointments/bad', 'seats[0]')]);
    expect(lines.map((line) => line.msg)).toEqual([
      'malformed document refused',
    ]);
  });

  it('observeAppointment emits the refusal for a malformed visit', () => {
    const fake = new FakeFirestore({
      'appointments/a1': {
        ...storedVisit({ at: '2026-10-12T10:00:00+03:00' }),
        bookingStatus: 'BOOKED',
      },
    });
    const found = recorded(
      guarded(fake).ports.observeAppointment(AppointmentId.of('a1')),
    );
    expect(found.seen).toEqual([malformed('appointments/a1', 'bookingStatus')]);
  });

  it('pageClientHistory cuts the page on the raw rows, drops the malformed one, and the history continues', async () => {
    const fake = new FakeFirestore({
      'appointments/a-01': storedVisit({ at: '2026-06-02T10:00:00+03:00' }),
      'appointments/a-02': storedVisit({ at: '2026-07-01T10:00:00+03:00' }),
      'appointments/a-03': storedVisit({ at: '2026-08-05T10:00:00+03:00' }),
      'appointments/a-04': {
        ...storedVisit({ at: '2026-09-02T10:00:00+03:00' }),
        revision: -1,
      },
      'appointments/a-05': storedVisit({ at: '2026-09-28T10:00:00+03:00' }),
    });
    const { lines, ports } = guarded(fake);

    const first = await ports.pageClientHistory(GEORGI, null, 3);
    if (!first.ok) throw new Error('first page refused');
    expect(first.value.appointments.map((a) => a.id)).toEqual(['a-05', 'a-03']);
    // The cursor the RAW rows give — the page's oldest row as read.
    expect(first.value.nextBeforeUtcMs).toBe(
      utcMs('2026-08-05T10:00:00+03:00'),
    );
    const rest = await ports.pageClientHistory(
      GEORGI,
      first.value.nextBeforeUtcMs,
      3,
    );
    expect(rest.ok && rest.value.appointments.map((a) => a.id)).toEqual([
      'a-02',
      'a-01',
    ]);
    expect(lines.map((line) => line.fields)).toEqual([
      { path: 'appointments/a-04', field: 'revision' },
    ]);
  });

  it('pageClientHistory never lets a non-numeric utcEpochMs become the cursor — the history reaches the oldest visit', async () => {
    const fake = new FakeFirestore({
      'appointments/a-01': storedVisit({ at: '2026-06-02T10:00:00+03:00' }),
      'appointments/a-02': storedVisit({ at: '2026-07-01T10:00:00+03:00' }),
      'appointments/a-03': storedVisit({ at: '2026-08-05T10:00:00+03:00' }),
      'appointments/x-text': {
        ...storedVisit({ at: '2026-09-02T10:00:00+03:00' }),
        utcEpochMs: 'x',
      },
      'appointments/x-nan': {
        ...storedVisit({ at: '2026-09-03T10:00:00+03:00' }),
        utcEpochMs: Number.NaN,
      },
    });
    const { ports } = guarded(fake);

    const first = await ports.pageClientHistory(GEORGI, null, 2);
    if (!first.ok) throw new Error('first page refused');
    expect(first.value.appointments.map((a) => a.id)).toEqual(['a-03', 'a-02']);
    expect(first.value.nextBeforeUtcMs).toBe(
      utcMs('2026-07-01T10:00:00+03:00'),
    );
    const rest = await ports.pageClientHistory(
      GEORGI,
      first.value.nextBeforeUtcMs,
      2,
    );
    expect(rest.ok && rest.value.appointments.map((a) => a.id)).toEqual([
      'a-01',
    ]);
    expect(rest.ok && rest.value.nextBeforeUtcMs).toBeNull();
  });

  it('pageClientHistory ends the history at a NaN cursor — NaN sorts below every instant, and no range below it exists', async () => {
    const fake = new FakeFirestore({
      'appointments/a-01': storedVisit({ at: '2026-06-02T10:00:00+03:00' }),
      'appointments/x-nan-1': {
        ...storedVisit({ at: '2026-07-01T10:00:00+03:00' }),
        utcEpochMs: Number.NaN,
      },
      'appointments/x-nan-2': {
        ...storedVisit({ at: '2026-08-05T10:00:00+03:00' }),
        utcEpochMs: Number.NaN,
      },
    });
    const { lines, ports } = guarded(fake);

    const only = await ports.pageClientHistory(GEORGI, null, 2);
    if (!only.ok) throw new Error('page refused');
    expect(only.value.appointments.map((a) => a.id)).toEqual(['a-01']);
    expect(only.value.nextBeforeUtcMs).toBeNull();
    expect(lines.map((line) => line.fields)).toEqual([
      // Ties order by id in the read's direction: x-nan-2 is the page's last row.
      { path: 'appointments/x-nan-2', field: 'utcEpochMs' },
    ]);
  });

  it('pageClientHistory refuses a FIRST page whose every row is malformed — never an empty history', async () => {
    const fake = new FakeFirestore({
      'appointments/a-01': {
        ...storedVisit({ at: '2026-06-02T10:00:00+03:00' }),
        locationId: '',
      },
    });
    expect(
      await guarded(fake).ports.pageClientHistory(GEORGI, null, 5),
    ).toEqual(malformed('appointments/a-01', 'locationId'));
  });

  it('pageClientHistory ends the history on a last page of one malformed row — an empty page, no cursor, no error', async () => {
    const fake = new FakeFirestore({
      'appointments/a-01': {
        ...storedVisit({ at: '2026-06-02T10:00:00+03:00' }),
        revision: -1,
      },
      'appointments/a-02': storedVisit({ at: '2026-08-05T10:00:00+03:00' }),
      'appointments/a-03': storedVisit({ at: '2026-09-28T10:00:00+03:00' }),
    });
    const { lines, ports } = guarded(fake);

    const first = await ports.pageClientHistory(GEORGI, null, 2);
    if (!first.ok) throw new Error('first page refused');
    expect(first.value.appointments.map((a) => a.id)).toEqual(['a-03', 'a-02']);
    const last = await ports.pageClientHistory(
      GEORGI,
      first.value.nextBeforeUtcMs,
      2,
    );
    expect(last).toEqual(
      Result.ok({ appointments: [], nextBeforeUtcMs: null }),
    );
    expect(lines.map((line) => line.fields)).toEqual([
      { path: 'appointments/a-01', field: 'revision' },
    ]);
  });

  it('pageClientHistory keeps the cursor past a middle page of only malformed rows — the older visits still load', async () => {
    const fake = new FakeFirestore({
      'appointments/a-01': storedVisit({ at: '2026-06-02T10:00:00+03:00' }),
      'appointments/a-02': malformedVisit({ at: '2026-08-05T10:00:00+03:00' }),
      'appointments/a-03': storedVisit({ at: '2026-09-28T10:00:00+03:00' }),
    });
    const { ports } = guarded(fake);

    const first = await ports.pageClientHistory(GEORGI, null, 1);
    if (!first.ok) throw new Error('first page refused');
    expect(first.value.appointments.map((a) => a.id)).toEqual(['a-03']);
    const middle = await ports.pageClientHistory(
      GEORGI,
      first.value.nextBeforeUtcMs,
      1,
    );
    expect(middle).toEqual(
      Result.ok({
        appointments: [],
        nextBeforeUtcMs: utcMs('2026-08-05T10:00:00+03:00'),
      }),
    );
    const oldest = await ports.pageClientHistory(
      GEORGI,
      middle.ok ? middle.value.nextBeforeUtcMs : null,
      1,
    );
    expect(oldest).toEqual(
      Result.ok({
        appointments: [
          expect.objectContaining({ id: AppointmentId.of('a-01') }),
        ],
        nextBeforeUtcMs: null,
      }),
    );
  });

  it('searchAppointmentWindow drops a malformed visit from its half and answers the rest', async () => {
    const NOW: UtcEpochMs = utcMs('2026-10-12T12:00:00+03:00');
    const fake = new FakeFirestore({
      'appointments/p1': storedVisit({ at: '2026-10-11T10:00:00+03:00' }),
      'appointments/p2': malformedVisit({ at: '2026-10-12T10:00:00+03:00' }),
      'appointments/n1': storedVisit({ at: '2026-10-13T10:00:00+03:00' }),
    });
    const pool = await guarded(fake).ports.searchAppointmentWindow(NOW, 5);
    expect(idsOf(pool)).toEqual(['p1', 'n1']);
  });

  it('searchAppointmentWindow judges the WHOLE window: the evening’s only upcoming visit malformed still answers the past visits, and reports the drop', async () => {
    const NOW: UtcEpochMs = utcMs('2026-10-12T21:00:00+03:00');
    const fake = new FakeFirestore({
      'appointments/p2': storedVisit({ at: '2026-10-11T10:00:00+03:00' }),
      'appointments/p1': storedVisit({ at: '2026-10-12T10:00:00+03:00' }),
      'appointments/n1': {
        ...storedVisit({ at: '2026-10-13T10:00:00+03:00' }),
        bookingStatus: 'BOGUS',
      },
    });
    const { lines, ports } = guarded(fake);
    expect(idsOf(await ports.searchAppointmentWindow(NOW, 5))).toEqual([
      'p2',
      'p1',
    ]);
    expect(lines).toEqual([
      {
        level: 'error',
        msg: 'malformed document dropped',
        fields: { path: 'appointments/n1', field: 'bookingStatus' },
      },
    ]);
  });

  it('searchAppointmentWindow refuses only a window that read rows and kept none', async () => {
    const NOW: UtcEpochMs = utcMs('2026-10-12T12:00:00+03:00');
    const fake = new FakeFirestore({
      'appointments/p1': malformedVisit({ at: '2026-10-11T10:00:00+03:00' }),
      'appointments/n1': malformedVisit({ at: '2026-10-13T10:00:00+03:00' }),
    });
    expect(await guarded(fake).ports.searchAppointmentWindow(NOW, 5)).toEqual(
      malformed('appointments/p1', 'seats[0]'),
    );
    expect(
      await guarded(new FakeFirestore({})).ports.searchAppointmentWindow(
        NOW,
        5,
      ),
    ).toEqual(Result.ok([]));
  });
});
