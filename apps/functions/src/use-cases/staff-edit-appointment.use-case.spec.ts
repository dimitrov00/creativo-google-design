import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok, fail } from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
import {
  BookingPolicy,
  CalendarDay,
  Interval,
  StaffScheduleHistory,
  WeeklyPattern,
} from '@creativo/domain/scheduling';
import {
  type PersistedDocument,
  appointmentToDocument,
} from '@creativo/application/booking';
import type { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import type {
  BookingDecision,
  BookingSnapshot,
  DecideBookingRequest,
  LoadedSchedule,
} from './decide-booking';
import { CommitBookingInvalidInputError } from './commit-booking.errors';
import type { StaffEditError } from './staff-edit-appointment.errors';
import {
  type StaffEditCommand,
  StaffEditAppointmentUseCase,
} from './staff-edit-appointment.use-case';

const ZONE = 'Europe/Sofia';
const OWNER = 'user-1';
const APPOINTMENT = 'appt-1';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** 2026-08-03 is a Monday in Sofia — the fixture roster works Mondays. */
function at(hour: number, minute = 0): ZonedDateTime {
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute },
      ZONE,
    ),
  );
}

const OPEN_9_20 = { kind: 'open' as const, opens: '09:00', closes: '20:00' };
const CLOSED = { kind: 'closed' as const };
const SHOP_HOURS = [
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  CLOSED,
];

/**
 * The fixture service — 45 minutes at 40 €, with 10 minutes of cleanup, which
 * is what makes the buffer visible in the collision tests.
 */
function fadeService(priceMinorUnits = 4000): Service {
  return unwrap(
    Service.create({
      id: 'svc-fade',
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits,
      currencyCode: 'EUR',
      durationMinutes: 45,
      cleanupMinutes: 10,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [],
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

/**
 * The same service, but the catalogue now offers a length choice.
 *
 * ⚠ This exists for ONE regression. Every seat booked before a service gained
 * a variant is legitimately stored with `variantId: null`, and `decideBooking`
 * used to refuse any re-decide of such a seat — freezing appointments that
 * already exist, which is the precise opposite of what this use case is for.
 * The original fixture declared `variants: []`, so no staff-edit test ever
 * re-decided a variant service and the refusal shipped unnoticed.
 */
function fadeWithVariants(): Service {
  return unwrap(
    Service.create({
      id: 'svc-fade',
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 4000,
      currencyCode: 'EUR',
      durationMinutes: 45,
      cleanupMinutes: 10,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [
        {
          id: 'short',
          name: { bg: 'Къса', en: 'Short' },
          priceMinorUnits: 4000,
          durationMinutes: 45,
        },
        {
          id: 'long',
          name: { bg: 'Дълга', en: 'Long' },
          priceMinorUnits: 5000,
          durationMinutes: 60,
        },
      ],
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

function schedule(turnaroundMinutes = 0): LoadedSchedule {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  const pattern = unwrap(
    WeeklyPattern.create({ byWeekday: { monday: day, tuesday: day } }),
  );
  return {
    history: StaffScheduleHistory.startingWith(
      pattern,
      unwrap(CalendarDay.create('2026-01-01', ZONE)),
    ),
    turnaroundMinutes,
  };
}

function snapshot(overrides: Partial<BookingSnapshot> = {}): BookingSnapshot {
  return {
    zone: ZONE,
    shopHours: SHOP_HOURS,
    services: [fadeService()],
    schedules: new Map([
      ['ivan', schedule()],
      ['petar', schedule()],
    ]),
    busy: new Map(),
    exceptions: new Map(),
    ...overrides,
  };
}

interface SeatFixture {
  readonly id?: string;
  readonly barberId?: string;
  readonly startIso?: string;
  readonly durationMinutes?: number;
  readonly priceMinorUnits?: number;
  readonly outcome?: Record<string, unknown>;
  readonly subject?: Record<string, unknown>;
}

function seatDoc(fixture: SeatFixture = {}): Record<string, unknown> {
  const startIso = fixture.startIso ?? at(10).toISO();
  const durationMinutes = fixture.durationMinutes ?? 45;
  const start = unwrap(ZonedDateTime.fromISO(startIso, ZONE));
  return {
    id: fixture.id ?? 'seat-1',
    serviceId: 'svc-fade',
    variantId: null,
    barberId: fixture.barberId ?? 'ivan',
    barberPref: 'specific',
    terms: {
      priceMinorUnits: fixture.priceMinorUnits ?? 4000,
      currencyCode: 'EUR',
      durationMinutes,
      setupMinutes: 0,
      cleanupMinutes: 10,
      catalogPriceMinorUnits: null,
      catalogDurationMinutes: null,
    },
    slot: {
      startIso,
      endIso: start.plusMinutes(durationMinutes).toISO(),
      zone: ZONE,
    },
    subject: fixture.subject ?? {
      kind: 'account',
      userId: OWNER,
      relationship: 'self',
    },
    outcome: fixture.outcome ?? { kind: 'scheduled' },
  };
}

function document(
  overrides: Partial<PersistedDocument> = {},
  seats: readonly Record<string, unknown>[] = [seatDoc()],
): PersistedDocument {
  return {
    locationId: 'loc-center',
    ownerUserId: OWNER,
    barberIds: ['ivan'],
    busyKeys: ['ivan__2026-08-03'],
    timeSlot: {
      startIso: at(10).toISO(),
      endIso: at(10, 45).toISO(),
      zone: ZONE,
    },
    seats,
    status: { kind: 'confirmed' },
    bookedAt: { iso: at(8).toISO(), zone: ZONE },
    bookedFromAppointmentId: null,
    arrivedAt: null,
    contact: { name: 'Иван', phone: '+359888123456', email: null, note: null },
    revision: 3,
    // NOT a field `appointmentToDocument` writes — the preservation probe.
    staffNote: 'дължи 5 лв от миналия път',
    ...overrides,
  };
}

/**
 * A stand-in for `FirestoreBookingStore` that runs the same three callbacks in
 * the same order the real transaction does, minus Firestore.
 *
 * The own-contribution subtraction is not modelled: every busy fixture below
 * holds SOMEBODY ELSE's spans, which is what the real store's `decide` sees
 * after subtracting this appointment's own.
 */
function makeStore(
  current: PersistedDocument,
  view: BookingSnapshot = snapshot(),
) {
  const captured: {
    decision?: BookingDecision;
    extra?: Record<string, unknown>;
    request?: DecideBookingRequest;
  } = {};

  const store = {
    async reschedule(
      _appointmentId: string,
      canWrite: (doc: PersistedDocument) => boolean,
      plan: (
        doc: PersistedDocument,
      ) => Result<DecideBookingRequest, StaffEditError>,
      decide: (
        view: BookingSnapshot,
        doc: PersistedDocument,
        request: DecideBookingRequest,
      ) => Result<BookingDecision, StaffEditError>,
      extraFields: (
        doc: PersistedDocument,
      ) => Record<string, unknown> = () => ({}),
    ) {
      if (!canWrite(current)) {
        return fail(new CommitBookingInvalidInputError('appointmentId'));
      }
      const planned = plan(current);
      if (planned.isFailure()) return fail(planned.error);
      captured.request = planned.value;

      const decision = decide(view, current, planned.value);
      if (decision.isFailure()) return fail(decision.error);
      captured.decision = decision.value;
      captured.extra = extraFields(current);
      return ok({ kind: 'committed' as const, decision: decision.value });
    },
  };

  return { store: store as unknown as FirestoreBookingStore, captured };
}

const CLOCK = { now: () => ok(at(9)) };

function useCase(store: FirestoreBookingStore): StaffEditAppointmentUseCase {
  return new StaffEditAppointmentUseCase(
    store,
    CLOCK as never,
    BookingPolicy.default(),
  );
}

async function edit(
  command: StaffEditCommand | readonly StaffEditCommand[],
  options: {
    readonly current?: PersistedDocument;
    readonly view?: BookingSnapshot;
    readonly roles?: readonly string[];
    readonly actorUserId?: string | null;
    readonly acknowledgedOverlap?: boolean;
    readonly expectedVersion?: number | null;
  } = {},
) {
  const { store, captured } = makeStore(
    options.current ?? document(),
    options.view ?? snapshot(),
  );
  const result = await useCase(store).execute({
    appointmentId: APPOINTMENT,
    actorUserId:
      options.actorUserId === undefined ? 'staff-1' : options.actorUserId,
    actorRoles: options.roles ?? ['barber'],
    command,
    ...(options.acknowledgedOverlap === undefined
      ? {}
      : { acknowledgedOverlap: options.acknowledgedOverlap }),
    ...(options.expectedVersion === undefined
      ? {}
      : { expectedVersion: options.expectedVersion }),
  });
  return { result, captured };
}

/** The written document, as it would land in Firestore. */
function written(captured: { decision?: BookingDecision }): PersistedDocument {
  if (!captured.decision) throw new Error('nothing was written');
  return appointmentToDocument(captured.decision.appointment);
}

function seatsOf(captured: { decision?: BookingDecision }) {
  return written(captured)['seats'] as readonly Record<string, unknown>[];
}

function code(result: Result<unknown, StaffEditError>): string {
  if (result.isSuccess()) throw new Error('expected a refusal');
  return result.error.code;
}

describe("staffEditAppointment — a seat older than its service's variants", () => {
  it('moves a seat stored without a variant, on a service that now has some', async () => {
    // The shop added `Къса`/`Дълга` to Фейд last week. Every appointment
    // booked before that carries `variantId: null` and must still be
    // movable — the terms travel with the seat, so nothing is priced from
    // the catalogue and there is no `baseTerms` to charge by accident.
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { view: snapshot({ services: [fadeWithVariants()] }) },
    );

    expect(result.isSuccess()).toBe(true);
    // And it stays null: a `move` carries no variant to supply, so inventing
    // one would be the write making up a fact the document never held.
    expect(written(captured).seats[0]?.['variantId']).toBeNull();
  });
});

describe('staffEditAppointment — who may work the book', () => {
  it('refuses an unauthenticated caller', async () => {
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { actorUserId: null },
    );
    expect(code(result)).toBe('booking.staffEdit.unauthenticated');
  });

  it('refuses `content_manager` — the role the RULES refuse every read', async () => {
    // The whole reason this gate is `worksTheBook` and not `isStaff`. A
    // copy-and-media account cannot see this appointment; it must not be able
    // to move it either.
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { roles: ['content_manager'] },
    );
    expect(code(result)).toBe('booking.staffEdit.forbidden');
  });

  it('refuses a plain client', async () => {
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { roles: ['client'] },
    );
    expect(code(result)).toBe('booking.staffEdit.forbidden');
  });

  it.each(['barber', 'receptionist', 'admin', 'sysadmin'])(
    'admits %s',
    async (role) => {
      const { result } = await edit(
        { kind: 'move', startIso: at(11).toISO() },
        { roles: [role] },
      );
      expect(result.isSuccess()).toBe(true);
    },
  );

  it('moves a booking the actor does not own — that is the job', async () => {
    const { result, captured } = await edit({
      kind: 'move',
      startIso: at(11).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
    // The OWNER is the appointment's, never the staff actor's.
    expect(written(captured)['ownerUserId']).toBe(OWNER);
  });

  it('moves a WALK-IN nobody owns — previously unreschedulable by anyone', async () => {
    const walkIn = document({ ownerUserId: null }, [
      seatDoc({ subject: { kind: 'anonymous', label: 'Клиент 10:00' } }),
    ]);
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { current: walkIn },
    );
    expect(result.isSuccess()).toBe(true);
    expect(written(captured)['ownerUserId']).toBeNull();
  });
});

describe('staffEditAppointment — move', () => {
  it('shifts the start and holds the duration', async () => {
    const { result, captured } = await edit({
      kind: 'move',
      startIso: at(14).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
    const [seat] = seatsOf(captured);
    expect((seat?.['slot'] as Record<string, string>)['startIso']).toBe(
      at(14).toISO(),
    );
    expect((seat?.['terms'] as Record<string, number>)['durationMinutes']).toBe(
      45,
    );
  });

  it('shifts every seat of a party by ONE delta, preserving the arrangement', async () => {
    const party = document({ barberIds: ['ivan', 'petar'] }, [
      seatDoc({ id: 'seat-1', startIso: at(10).toISO() }),
      seatDoc({
        id: 'seat-2',
        barberId: 'petar',
        startIso: at(10, 45).toISO(),
        subject: { kind: 'anonymous', label: 'Гост' },
      }),
    ]);
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(12).toISO() },
      { current: party },
    );
    expect(result.isSuccess()).toBe(true);
    const starts = seatsOf(captured).map(
      (seat) => (seat['slot'] as Record<string, string>)['startIso'],
    );
    expect(starts).toEqual([at(12).toISO(), at(12, 45).toISO()]);
  });

  /*
   * A SCOPED move — one barber leaving a party without taking it with them.
   *
   * The case these exist for: a father with Ivan and his son with Petar, and
   * Petar has to push his half back an hour. Before the scope, `move` could
   * only mean the envelope, so Petar's drag moved the father too.
   */
  it('shifts ONLY the named seats, leaving the rest of the party put', async () => {
    const party = document({ barberIds: ['ivan', 'petar'] }, [
      seatDoc({ id: 'seat-1', startIso: at(10).toISO() }),
      seatDoc({
        id: 'seat-2',
        barberId: 'petar',
        startIso: at(10, 45).toISO(),
        subject: { kind: 'anonymous', label: 'Гост' },
      }),
    ]);
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(12).toISO(), seatIds: ['seat-2'] },
      { current: party },
    );
    expect(result.isSuccess()).toBe(true);
    const starts = seatsOf(captured).map(
      (seat) => (seat['slot'] as Record<string, string>)['startIso'],
    );
    // seat-1 has not moved; seat-2 landed exactly where it was dropped —
    // measured from ITS OWN start, not the party's.
    expect(starts).toEqual([at(10).toISO(), at(12).toISO()]);
  });

  it('refuses a scope naming a seat this booking does not have', async () => {
    const { result } = await edit({
      kind: 'move',
      startIso: at(12).toISO(),
      seatIds: ['seat-99'],
    });
    expect(result.isFailure()).toBe(true);
  });

  /*
   * The one outcome a scope must never have. An empty list is a caller bug,
   * and treating it as "unscoped" would silently move the whole party —
   * exactly the behaviour the scope was added to prevent.
   */
  it('refuses an EMPTY scope rather than widening it to the whole party', async () => {
    const { result } = await edit({
      kind: 'move',
      startIso: at(12).toISO(),
      seatIds: [],
    });
    expect(result.isFailure()).toBe(true);
  });

  it('resizes only the scoped seat, not whichever runs latest', async () => {
    const party = document({ barberIds: ['ivan', 'petar'] }, [
      // seat-1 runs to 11:30 and so OWNS the party envelope's end; seat-2
      // finishes at 10:45.
      seatDoc({ id: 'seat-1', startIso: at(10).toISO(), durationMinutes: 90 }),
      seatDoc({
        id: 'seat-2',
        barberId: 'petar',
        startIso: at(10).toISO(),
        subject: { kind: 'anonymous', label: 'Гост' },
      }),
    ]);
    const { result, captured } = await edit(
      {
        kind: 'resize',
        edge: 'end',
        atIso: at(11).toISO(),
        seatIds: ['seat-2'],
      },
      { current: party },
    );
    expect(result.isSuccess()).toBe(true);
    const minutes = seatsOf(captured).map(
      (seat) => (seat['terms'] as Record<string, number>)['durationMinutes'],
    );
    // Unscoped, the delta would have been measured against 11:30 and applied
    // to seat-1 — the seat in the chair nobody dragged.
    expect(minutes).toEqual([90, 60]);
  });

  /*
   * ── TIPS SURVIVE AN EDIT ─────────────────────────────────────────────
   *
   * Tips are RECORDED by `recordSeatTip`, not here — this path rebuilds the
   * booking and refuses a settled visit, which is the only kind that gets
   * tipped. What it must do is not destroy one: the rebuild re-derives every
   * seat from the catalogue, which knows nothing about money the shop never
   * charged, so a tip not restored explicitly is a tip erased by the next
   * drag of the block.
   */
  it('preserves a recorded tip across a move', async () => {
    const tipped = document({}, [
      { ...seatDoc({ id: 'seat-1' }), tipMinorUnits: 700 },
    ]);
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(12).toISO() },
      { current: tipped },
    );
    expect(result.isSuccess()).toBe(true);
    expect(seatsOf(captured)[0]?.['tipMinorUnits']).toBe(700);
  });

  it('preserves a ZERO tip, which is a recording and not an absence', async () => {
    const tipped = document({}, [
      { ...seatDoc({ id: 'seat-1' }), tipMinorUnits: 0 },
    ]);
    const { captured } = await edit(
      { kind: 'move', startIso: at(12).toISO() },
      { current: tipped },
    );
    expect(seatsOf(captured)[0]?.['tipMinorUnits']).toBe(0);
  });

  it('leaves an untipped seat untipped rather than defaulting it to zero', async () => {
    const { captured } = await edit({ kind: 'move', startIso: at(12).toISO() });
    expect(seatsOf(captured)[0]?.['tipMinorUnits']).toBeNull();
  });

  it('keeps the seat ids, so per-seat actions are not orphaned', async () => {
    const { captured } = await edit({ kind: 'move', startIso: at(11).toISO() });
    expect(seatsOf(captured).map((seat) => seat['id'])).toEqual(['seat-1']);
  });

  it('keeps `barberPref` — the fact that decides whether staff may phone', async () => {
    const { captured } = await edit({ kind: 'move', startIso: at(11).toISO() });
    expect(seatsOf(captured)[0]?.['barberPref']).toBe('specific');
  });

  it('keeps the status, the contact and the booking instant', async () => {
    const { captured } = await edit({ kind: 'move', startIso: at(11).toISO() });
    const doc = written(captured);
    expect(doc['status']).toEqual({ kind: 'confirmed' });
    expect((doc['contact'] as Record<string, string>)['phone']).toBe(
      '+359888123456',
    );
    // Restamping `bookedAt` would collapse booking lead time toward zero for
    // exactly the bookings planned furthest ahead.
    expect((doc['bookedAt'] as Record<string, string>)['iso']).toBe(
      at(8).toISO(),
    );
  });
});

describe('staffEditAppointment — resize', () => {
  it('`end` holds the start and writes a duration', async () => {
    const { result, captured } = await edit({
      kind: 'resize',
      edge: 'end',
      atIso: at(11, 30).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
    const [seat] = seatsOf(captured);
    expect((seat?.['slot'] as Record<string, string>)['startIso']).toBe(
      at(10).toISO(),
    );
    expect((seat?.['terms'] as Record<string, number>)['durationMinutes']).toBe(
      90,
    );
  });

  it('`start` holds the END and writes both', async () => {
    // "I'll start ten minutes later but still finish at eleven."
    const { result, captured } = await edit({
      kind: 'resize',
      edge: 'start',
      atIso: at(10, 15).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
    const [seat] = seatsOf(captured);
    expect((seat?.['slot'] as Record<string, string>)['startIso']).toBe(
      at(10, 15).toISO(),
    );
    expect((seat?.['slot'] as Record<string, string>)['endIso']).toBe(
      at(10, 45).toISO(),
    );
  });

  it('extends only the seats that OWN the edge', async () => {
    const chain = document({}, [
      seatDoc({ id: 'seat-1', startIso: at(10).toISO() }),
      seatDoc({
        id: 'seat-2',
        startIso: at(10, 45).toISO(),
        barberId: 'petar',
        subject: { kind: 'anonymous', label: 'Гост' },
      }),
    ]);
    const { captured } = await edit(
      { kind: 'resize', edge: 'end', atIso: at(12).toISO() },
      { current: chain },
    );
    const durations = seatsOf(captured).map(
      (seat) => (seat['terms'] as Record<string, number>)['durationMinutes'],
    );
    // The chain runs 10:00–10:45 then 10:45–11:30; pulling the bottom handle
    // to 12:00 adds thirty minutes to the LAST leg and leaves the first
    // exactly as it was.
    expect(durations).toEqual([45, 75]);
  });

  it('refuses a resize that drives the duration to zero — as a DURATION', async () => {
    // Not `invalid_range`: the end is derived, so `До ≤ От` has no field to
    // live in and the only thing that can be wrong is the duration.
    const { result } = await edit({
      kind: 'resize',
      edge: 'end',
      atIso: at(10).toISO(),
    });
    expect(code(result)).toBe('booking.staffEdit.invalid_command');
  });
});

describe('staffEditAppointment — services added and removed', () => {
  it('adds a seat after the visit, priced by the catalogue, not the client', async () => {
    const { result, captured } = await edit([
      {
        kind: 'addSeat',
        seatId: 'seat-2',
        serviceId: 'svc-fade',
        barberId: 'ivan',
        startIso: at(10, 45).toISO(),
        // The client says 30; the catalogue says 45 and wins.
        minutes: 30,
        subject: { kind: 'self' },
      },
    ]);
    expect(result.isSuccess()).toBe(true);
    const seats = seatsOf(captured);
    expect(seats.map((seat) => seat['id'])).toEqual(['seat-1', 'seat-2']);
    const added = seats[1] as Record<string, unknown>;
    const terms = added['terms'] as Record<string, unknown>;
    expect(terms['priceMinorUnits']).toBe(4000);
    expect(terms['durationMinutes']).toBe(45);
    // Nothing overridden — the catalogue pair stays null.
    expect(terms['catalogPriceMinorUnits']).toBeNull();
    expect((added['slot'] as Record<string, unknown>)['startIso']).toBe(
      at(10, 45).toISO(),
    );
    expect((added['subject'] as Record<string, unknown>)['relationship']).toBe(
      'self',
    );
    expect((added['outcome'] as Record<string, unknown>)['kind']).toBe(
      'scheduled',
    );
  });

  it('marks a seat added to a FINISHED visit as worked, not scheduled', async () => {
    // The sheet filled in after the cut (owner, 2026-09-09): the service was
    // done, so the seat is history the moment it is written.
    const done = document({ status: { kind: 'completed' } });
    const { result, captured } = await edit(
      [
        {
          kind: 'addSeat',
          seatId: 'seat-2',
          serviceId: 'svc-fade',
          barberId: 'ivan',
          startIso: at(10, 45).toISO(),
          minutes: 45,
          subject: { kind: 'self' },
        },
      ],
      { current: done },
    );
    expect(result.isSuccess()).toBe(true);
    const added = seatsOf(captured)[1] as Record<string, unknown>;
    expect((added['outcome'] as Record<string, unknown>)['kind']).toBe(
      'worked',
    );
  });

  it('lets one person hold a second, SEQUENTIAL seat — but never two at once', async () => {
    const atOnce = await edit([
      {
        kind: 'addSeat',
        seatId: 'seat-2',
        serviceId: 'svc-fade',
        barberId: 'petar',
        startIso: at(10).toISO(),
        minutes: 45,
        subject: { kind: 'self' },
      },
    ]);
    expect(atOnce.result.isSuccess()).toBe(false);
  });

  it('refuses a fresh seat on a chair the shop does not roster', async () => {
    const { result } = await edit([
      {
        kind: 'addSeat',
        seatId: 'seat-2',
        serviceId: 'svc-fade',
        barberId: 'Нико Димов',
        startIso: at(10, 45).toISO(),
        minutes: 45,
        subject: { kind: 'self' },
      },
    ]);
    expect(code(result)).toBe('booking.staffEdit.invalid_command');
  });

  it('removes a scheduled seat and keeps the others', async () => {
    const { result, captured } = await edit(
      { kind: 'removeSeat', seatId: 'seat-2' },
      {
        current: document({}, [
          seatDoc(),
          seatDoc({ id: 'seat-2', startIso: at(10, 45).toISO() }),
        ]),
      },
    );
    expect(result.isSuccess()).toBe(true);
    expect(seatsOf(captured).map((seat) => seat['id'])).toEqual(['seat-1']);
  });

  it('refuses to remove the last seat, or one somebody already sat in', async () => {
    const last = await edit({ kind: 'removeSeat', seatId: 'seat-1' });
    expect(code(last.result)).toBe('booking.staffEdit.invalid_command');
    const worked = await edit(
      { kind: 'removeSeat', seatId: 'seat-2' },
      {
        current: document({}, [
          seatDoc(),
          seatDoc({
            id: 'seat-2',
            startIso: at(10, 45).toISO(),
            outcome: { kind: 'worked', atMs: at(11, 30).toMillis() },
          }),
        ]),
      },
    );
    expect(code(worked.result)).toBe('booking.staffEdit.invalid_command');
  });

  it('applies an add before the resize that follows it in one batch', async () => {
    // The dashboard sends add → move → resize(end = start + every leg).
    const { result, captured } = await edit([
      {
        kind: 'addSeat',
        seatId: 'seat-2',
        serviceId: 'svc-fade',
        barberId: 'ivan',
        startIso: at(10, 45).toISO(),
        minutes: 45,
        subject: { kind: 'self' },
      },
      { kind: 'move', startIso: at(10).toISO() },
      { kind: 'resize', edge: 'end', atIso: at(11, 30).toISO() },
    ]);
    expect(result.isSuccess()).toBe(true);
    const seats = seatsOf(captured);
    expect(
      seats.map(
        (seat) => (seat['terms'] as Record<string, unknown>)['durationMinutes'],
      ),
    ).toEqual([45, 45]);
  });
});

describe('staffEditAppointment — the three acts that are not geometry', () => {
  it('reprices ONE seat and records what the catalogue said', async () => {
    const { result, captured } = await edit({
      kind: 'reprice',
      seatId: 'seat-1',
      priceMinorUnits: 2500,
    });
    expect(result.isSuccess()).toBe(true);
    const terms = seatsOf(captured)[0]?.['terms'] as Record<string, unknown>;
    expect(terms['priceMinorUnits']).toBe(2500);
    // The provenance pair — without it a discount round-trips
    // indistinguishable from a catalogue price and the history is gone.
    expect(terms['catalogPriceMinorUnits']).toBe(4000);
    expect(terms['catalogDurationMinutes']).toBe(45);
  });

  it('re-times ONE seat', async () => {
    const { result, captured } = await edit({
      kind: 'redurate',
      seatId: 'seat-1',
      minutes: 30,
    });
    expect(result.isSuccess()).toBe(true);
    const terms = seatsOf(captured)[0]?.['terms'] as Record<string, unknown>;
    expect(terms['durationMinutes']).toBe(30);
    expect(terms['catalogDurationMinutes']).toBe(45);
  });

  it('moves ONE seat to another chair', async () => {
    const { result, captured } = await edit({
      kind: 'restaff',
      seatId: 'seat-1',
      barberId: 'petar',
    });
    expect(result.isSuccess()).toBe(true);
    expect(seatsOf(captured)[0]?.['barberId']).toBe('petar');
    expect(written(captured)['barberIds']).toEqual(['petar']);
  });

  it('refuses a seat the appointment does not have', async () => {
    const { result } = await edit({
      kind: 'reprice',
      seatId: 'seat-99',
      priceMinorUnits: 100,
    });
    expect(code(result)).toBe('booking.staffEdit.invalid_command');
  });

  it('refuses a command with no kind at all', async () => {
    const { result } = await edit({} as StaffEditCommand);
    expect(code(result)).toBe('booking.staffEdit.invalid_command');
  });

  it('does NOT re-price a booking somebody merely dragged', async () => {
    // The terms are a snapshot taken at commit; a move is not a re-sale. The
    // catalogue has since gone up to 55 € and the client still pays 40 €.
    const { captured } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { view: snapshot({ services: [fadeService(5500)] }) },
    );
    const terms = seatsOf(captured)[0]?.['terms'] as Record<string, unknown>;
    expect(terms['priceMinorUnits']).toBe(4000);
    // And the catalogue's new answer is recorded beside it rather than lost.
    expect(terms['catalogPriceMinorUnits']).toBe(5500);
  });
});

describe('staffEditAppointment — the overlap is the one refusal staff may override', () => {
  const NEIGHBOUR = new Map([
    [
      'ivan__2026-08-03',
      [Interval.of(at(14).toMillis(), at(15).toMillis())] as const,
    ],
  ]);

  it('refuses a move onto somebody else, with no edge to blame', async () => {
    const { result } = await edit(
      { kind: 'move', startIso: at(14, 15).toISO() },
      { view: snapshot({ busy: NEIGHBOUR as never }) },
    );
    expect(code(result)).toBe('booking.staffEdit.overlaps');
    if (result.isFailure()) {
      expect(result.error.params['edge']).toBeUndefined();
    }
  });

  it('names the EDGE when a resize is what collided', async () => {
    const late = document({}, [seatDoc({ startIso: at(13, 30).toISO() })]);
    const { result } = await edit(
      { kind: 'resize', edge: 'end', atIso: at(14, 30).toISO() },
      { current: late, view: snapshot({ busy: NEIGHBOUR as never }) },
    );
    expect(code(result)).toBe('booking.staffEdit.overlaps');
    if (result.isFailure()) {
      expect(result.error.params['edge']).toBe('end');
    }
  });

  it('writes it anyway once the sheet has acknowledged it', async () => {
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(14, 15).toISO() },
      {
        view: snapshot({ busy: NEIGHBOUR as never }),
        acknowledgedOverlap: true,
      },
    );
    expect(result.isSuccess()).toBe(true);
    expect(
      (seatsOf(captured)[0]?.['slot'] as Record<string, string>)['startIso'],
    ).toBe(at(14, 15).toISO());
  });
});

describe('staffEditAppointment — staff placement is not bookable placement', () => {
  it('places the visit OUTSIDE the rostered window, with no second tap', async () => {
    // The roster runs 09:00–18:00. 08:00 is a regular before the shop opens —
    // a real thing that occupies real time. There is no request field for it.
    const { result, captured } = await edit({
      kind: 'move',
      startIso: at(8).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
    expect(
      (seatsOf(captured)[0]?.['slot'] as Record<string, string>)['startIso'],
    ).toBe(at(8).toISO());
  });

  it('places it on a chair with no roster document at all', async () => {
    const { result } = await edit(
      { kind: 'restaff', seatId: 'seat-1', barberId: 'petar' },
      { view: snapshot({ schedules: new Map([['ivan', schedule()]]) }) },
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('corrects a visit ALREADY IN THE CHAIR — the future-start rule is not asked', async () => {
    // The clock says 09:00 and the visit starts at 10:00; push it to 09:30,
    // which `Appointment.create` would refuse as "not after now" the moment
    // the clock passed it. A running-late nudge cannot be refused because ten
    // o'clock has already happened.
    const { result } = await edit({
      kind: 'move',
      startIso: at(9, 10).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('does not apply the cancellation window', async () => {
    // `mayCancelAt` is a CLIENT-fairness rule. The shop moving its own book at
    // 09:00 for a 10:00 visit is inside any window a shop would set, and it is
    // not refused here — the same ruling `transitionAppointment` already made.
    const { result } = await edit({
      kind: 'move',
      startIso: at(10, 30).toISO(),
    });
    expect(result.isSuccess()).toBe(true);
  });
});

describe('staffEditAppointment — what a move must not erase', () => {
  const ARRIVED = document({
    arrivedAt: { iso: at(9, 55).toISO(), zone: ZONE },
  });

  it('restores `arrivedAt` — without it the completion verb vanishes', async () => {
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { current: ARRIVED },
    );
    expect(result.isSuccess()).toBe(true);
    expect(
      (written(captured)['arrivedAt'] as Record<string, string>)['iso'],
    ).toBe(at(9, 55).toISO());
  });

  it('refuses a move that would END the visit before its arrival stamp', async () => {
    const { result } = await edit(
      { kind: 'move', startIso: at(8).toISO() },
      { current: ARRIVED },
    );
    // A DATA-INTEGRITY refusal, not a scheduling one.
    expect(code(result)).toBe('booking.staffEdit.before_arrival');
  });

  it('restores per-seat OUTCOMES, so a party mid-service stays movable', async () => {
    const mid = document({}, [
      seatDoc({ id: 'seat-1', outcome: { kind: 'worked', atMs: 1 } }),
      seatDoc({
        id: 'seat-2',
        barberId: 'petar',
        startIso: at(10, 45).toISO(),
        subject: { kind: 'anonymous', label: 'Гост' },
      }),
    ]);
    const { result, captured } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { current: mid },
    );
    // The reschedule path refuses this outright; a party where one guest is
    // already served is exactly the party someone needs to shorten.
    expect(result.isSuccess()).toBe(true);
    expect(seatsOf(captured).map((seat) => seat['outcome'])).toEqual([
      { kind: 'worked', atMs: 1 },
      { kind: 'scheduled' },
    ]);
  });

  it('keeps every document field this mapper does not own', async () => {
    const { captured } = await edit({ kind: 'move', startIso: at(11).toISO() });
    // A `set()` replaces the document whole, so an unknown field is a field a
    // staff edit would otherwise silently delete.
    expect(captured.extra?.['staffNote']).toBe('дължи 5 лв от миналия път');
  });

  it('refuses to touch a visit that never happened — cancelled is history', async () => {
    const gone = document({
      status: { kind: 'cancelled', reason: 'client', atMs: 1 },
    });
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { current: gone },
    );
    expect(code(result)).toBe('booking.commit.invalid_input');
  });

  it('lets a FINISHED visit be corrected — the sheet is filled in after the cut', async () => {
    // Owner, 2026-09-09: a barber who had no time for the sheet mid-visit
    // comes back to it. Completed is not cancelled; the book takes the edit.
    const done = document({ status: { kind: 'completed' } });
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { current: done },
    );
    expect(result.isSuccess()).toBe(true);
  });
});

describe('staffEditAppointment — the revision', () => {
  it('stamps the next revision beside the write', async () => {
    const { result, captured } = await edit({
      kind: 'move',
      startIso: at(11).toISO(),
    });
    expect(captured.extra?.['revision']).toBe(4);
    if (result.isSuccess()) expect(result.value.revision).toBe(4);
  });

  it('refuses a save drawn from a screen the book has moved past', async () => {
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { expectedVersion: 2 },
    );
    expect(code(result)).toBe('booking.staffEdit.stale');
  });

  it('does not refuse a caller that made no claim about what it read', async () => {
    const { result } = await edit(
      { kind: 'move', startIso: at(11).toISO() },
      { expectedVersion: null },
    );
    expect(result.isSuccess()).toBe(true);
  });

  /*
   * ── A SAVE IS A BATCH ─────────────────────────────────────────────────
   *
   * A gesture is one command; `Запази` is a day, a start, a duration and a
   * repriced leg arriving as ONE intent. Four requests would be four
   * placement decisions and a booking left half-moved when the third is
   * refused.
   */
  it('folds several commands in order and decides once', async () => {
    const { result, captured } = await edit([
      { kind: 'move', startIso: at(12).toISO() },
      { kind: 'resize', edge: 'start', atIso: at(12, 15).toISO() },
    ] as unknown as StaffEditCommand);

    expect(result.isSuccess()).toBe(true);
    /*
     * ⚠ 12:15, which is only reachable if the RESIZE saw the MOVE.
     *
     * The top handle holds the end and pulls the start, and it measures from
     * the scope's current start — so a resize applied against the STORED
     * seats would have measured from 10:00 and landed somewhere else
     * entirely. A later command seeing the one before it is the whole point
     * of folding rather than sending four requests.
     */
    expect(captured.request?.seats[0]?.startIso).toContain('12:15');
  });

  it('refuses the whole batch when one arm is malformed', async () => {
    const { result, captured } = await edit([
      { kind: 'move', startIso: at(12).toISO() },
      { kind: 'redurate', seatId: 'seat-1', minutes: 0 },
    ] as unknown as StaffEditCommand);

    expect(result.isFailure()).toBe(true);
    // The good arm must not land on its own: nothing was even planned.
    expect(captured.request).toBeUndefined();
  });

  it('refuses an empty batch rather than writing nothing quietly', async () => {
    const { result } = await edit([] as unknown as StaffEditCommand);
    expect(result.isFailure()).toBe(true);
  });
});
