import { describe, expect, it } from 'vitest';
import {
  Money,
  Result,
  ZonedDateTime,
  ok,
  fail,
} from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
import { Coupon, CouponValue, GiftVoucher } from '@creativo/domain/engagement';
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
  type DiscountResolver,
  type VoucherLedger,
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
        side: unknown,
      ) => Result<BookingDecision, StaffEditError>,
      extraFields: (
        doc: PersistedDocument,
      ) => Record<string, unknown> = () => ({}),
      side?: {
        read: (
          tx: unknown,
          doc: PersistedDocument,
          request: DecideBookingRequest,
        ) => Promise<Result<unknown, StaffEditError>>;
        write: (tx: unknown, decision: BookingDecision, side: unknown) => void;
      },
    ) {
      if (!canWrite(current)) {
        return fail(new CommitBookingInvalidInputError('appointmentId'));
      }
      const planned = plan(current);
      if (planned.isFailure()) return fail(planned.error);
      captured.request = planned.value;

      // The same order the real transaction keeps: the side reads after the
      // plan, the side writes after the decision.
      const sideRead = side
        ? await side.read(TX, current, planned.value)
        : ok(undefined);
      if (sideRead.isFailure()) return fail(sideRead.error);

      const decision = decide(view, current, planned.value, sideRead.value);
      if (decision.isFailure()) return fail(decision.error);
      captured.decision = decision.value;
      captured.extra = extraFields(current);
      side?.write(TX, decision.value, sideRead.value);
      return ok({ kind: 'committed' as const, decision: decision.value });
    },
  };

  return { store: store as unknown as FirestoreBookingStore, captured };
}

const CLOCK = { now: () => ok(at(9)) };

/** The fake's transaction handle — the ledger stub below never reads it. */
const TX = {} as never;

function useCase(
  store: FirestoreBookingStore,
  resolver?: DiscountResolver,
  ledger?: VoucherLedger,
): StaffEditAppointmentUseCase {
  return new StaffEditAppointmentUseCase(
    store,
    CLOCK as never,
    BookingPolicy.default(),
    resolver,
    ledger,
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
    readonly resolver?: DiscountResolver;
    readonly ledger?: VoucherLedger;
  } = {},
) {
  const { store, captured } = makeStore(
    options.current ?? document(),
    options.view ?? snapshot(),
  );
  const result = await useCase(store, options.resolver, options.ledger).execute(
    {
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
    },
  );
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

/*
 * ── THE BILL: DISCOUNTS (2026-09-10) ───────────────────────────────────
 * Facts about what is owed, not about any seat: settled before the fold,
 * resolved through promise lookups the transaction never waits on, and
 * snapshotted onto the appointment as a SET. Who may do what is the
 * accounts domain's split — a barber keeps the shop's promises, the front
 * desk may spend its money.
 */
describe('staffEditAppointment — the discounts on the bill', () => {
  const percent = (value: number): CouponValue =>
    unwrap(CouponValue.percentOff(value));
  const eur = (minor: number): Money =>
    unwrap(Money.fromMinorUnitsAndCode(minor, 'EUR'));

  const resolver: DiscountResolver = {
    async grant(grantId) {
      const base = { grantId, userId: OWNER, value: percent(20), usable: true };
      switch (grantId) {
        case 'grant-1':
          return { ...base, label: 'Рожден ден', exclusive: true };
        case 'grant-loyal':
          return {
            ...base,
            label: 'Постоянен клиент',
            value: percent(5),
            exclusive: false,
          };
        case 'grant-spent':
          return {
            ...base,
            label: 'Рожден ден',
            usable: false,
            exclusive: true,
          };
        case 'grant-other':
          return { ...base, userId: 'user-2', label: 'Чужд', exclusive: true };
        default:
          return null;
      }
    },
    async code(raw) {
      const code = Coupon.normalizeCode(raw);
      switch (code) {
        case 'FIRST10':
          return {
            couponId: 'coupon-first10',
            label: 'Първо посещение',
            value: percent(10),
            code,
            exclusive: false,
          };
        case 'BEARD5':
          return {
            couponId: 'coupon-beard5',
            label: 'Брада −5 €',
            value: unwrap(CouponValue.fixedAmount(eur(500))),
            code,
            exclusive: false,
          };
        case 'SOLO':
          return {
            couponId: 'coupon-solo',
            label: 'Само това',
            value: percent(15),
            code,
            exclusive: true,
          };
        default:
          return null;
      }
    },
  };

  const discountsOf = (captured: { decision?: BookingDecision }) =>
    written(captured)['discounts'] as readonly Record<string, unknown>[];
  const set = (
    discounts: readonly Record<string, unknown>[],
  ): StaffEditCommand =>
    ({ kind: 'discounts', discounts }) as unknown as StaffEditCommand;
  const manual = (percentOff: number) => ({
    source: 'manual',
    value: { kind: 'percent_off', percent: percentOff },
  });

  it('takes a manual percent off from the front desk and stores it as a snapshot', async () => {
    const { result, captured } = await edit(set([manual(10)]), {
      roles: ['receptionist'],
      resolver,
    });
    expect(result.isSuccess()).toBe(true);
    expect(discountsOf(captured)).toEqual([
      {
        id: 'manual',
        source: 'manual',
        label: 'manual',
        value: { kind: 'percent_off', percent: 10 },
        grantId: null,
        code: null,
        appliedAt: { iso: at(9).toISO(), zone: ZONE },
        combinability: 'stackable',
      },
    ]);
    // 10% off a 40,00 € fade: the aggregate's own total says 36,00 €.
    expect(captured.decision?.appointment.total().toMinorUnits()).toBe(3600);
    // The seats are untouched: a discount is not a reprice.
    expect(seatsOf(captured)[0]?.['terms']).toMatchObject({
      priceMinorUnits: 4000,
    });
  });

  it('refuses a NEW manual figure from a barber — forbidden, not malformed — but lets him keep one the desk set', async () => {
    const refused = await edit(set([manual(10)]), {
      roles: ['barber'],
      resolver,
    });
    expect(code(refused.result)).toBe('booking.staffEdit.forbidden');
    expect(refused.captured.decision).toBeUndefined();

    const storedManual = {
      id: 'manual',
      source: 'manual',
      label: 'manual',
      value: { kind: 'percent_off', percent: 10 },
      grantId: null,
      code: null,
      appliedAt: { iso: at(8).toISO(), zone: ZONE },
      combinability: 'stackable',
    };
    const kept = await edit(set([manual(10)]), {
      roles: ['barber'],
      resolver,
      current: document({ discounts: [storedManual] }),
    });
    expect(kept.result.isSuccess()).toBe(true);
    // Kept AS STORED: the instant is the desk's, not this save's.
    expect(discountsOf(kept.captured)).toEqual([storedManual]);
  });

  it("honours the client's own grant — a barber may — and refuses another client's, a spent one, or none", async () => {
    const honoured = await edit(
      set([{ source: 'grant', grantId: 'grant-1' }]),
      {
        roles: ['barber'],
        resolver,
      },
    );
    expect(honoured.result.isSuccess()).toBe(true);
    expect(discountsOf(honoured.captured)[0]).toMatchObject({
      id: 'grant:grant-1',
      source: 'grant',
      label: 'Рожден ден',
      grantId: 'grant-1',
      code: null,
      value: { kind: 'percent_off', percent: 20 },
      combinability: 'exclusive',
    });

    for (const grantId of ['grant-other', 'grant-spent', 'grant-unknown']) {
      const refused = await edit(set([{ source: 'grant', grantId }]), {
        roles: ['barber'],
        resolver,
      });
      expect(code(refused.result)).toBe('booking.staffEdit.invalid_command');
      expect(refused.captured.decision).toBeUndefined();
    }
  });

  it('opens a code the shop published, however it was typed, and refuses one it did not', async () => {
    const opened = await edit(set([{ source: 'code', code: ' first10 ' }]), {
      roles: ['barber'],
      resolver,
    });
    expect(opened.result.isSuccess()).toBe(true);
    expect(discountsOf(opened.captured)[0]).toMatchObject({
      id: 'code:coupon-first10',
      source: 'code',
      label: 'Първо посещение',
      code: 'FIRST10',
      grantId: null,
    });

    const refused = await edit(set([{ source: 'code', code: 'SUMMER' }]), {
      roles: ['barber'],
      resolver,
    });
    expect(code(refused.result)).toBe('booking.staffEdit.invalid_command');
  });

  it("stacks what may stack, in the evaluator's order, and refuses an exclusive coupon beside anything", async () => {
    const stacked = await edit(
      set([
        { source: 'code', code: 'FIRST10' },
        { source: 'code', code: 'BEARD5' },
        manual(10),
      ]),
      { roles: ['admin'], resolver },
    );
    expect(stacked.result.isSuccess()).toBe(true);
    expect(discountsOf(stacked.captured)).toHaveLength(3);
    // 40,00 − 5,00 = 35,00; then 10% and 10% on the running remainder:
    // 35,00 → 31,50 → 28,35. The evaluator's order, never the caller's.
    expect(stacked.captured.decision?.appointment.total().toMinorUnits()).toBe(
      2835,
    );

    for (const discounts of [
      [
        { source: 'code', code: 'SOLO' },
        { source: 'code', code: 'FIRST10' },
      ],
      [
        { source: 'grant', grantId: 'grant-1' },
        { source: 'grant', grantId: 'grant-loyal' },
      ],
      [
        { source: 'code', code: 'FIRST10' },
        { source: 'code', code: 'first10' },
      ],
      [manual(10), manual(20)],
    ]) {
      const refused = await edit(set(discounts), {
        roles: ['admin'],
        resolver,
      });
      expect(code(refused.result)).toBe('booking.staffEdit.invalid_command');
    }
    // Alone, the exclusive coupon is welcome.
    const alone = await edit(set([{ source: 'code', code: 'SOLO' }]), {
      roles: ['barber'],
      resolver,
    });
    expect(alone.result.isSuccess()).toBe(true);
  });

  it('keeps a stored discount whose coupon has since been retired, and carries the set through a move', async () => {
    const stored = {
      id: 'code:coupon-retired',
      source: 'code',
      label: 'Лятна промоция',
      value: { kind: 'percent_off', percent: 15 },
      grantId: null,
      code: 'SUMMER',
      appliedAt: { iso: at(8).toISO(), zone: ZONE },
      combinability: 'stackable',
    };
    // The resolver knows nothing of SUMMER any more; the visit still does.
    const kept = await edit(set([{ source: 'code', code: 'SUMMER' }]), {
      current: document({ discounts: [stored] }),
      roles: ['barber'],
      resolver,
    });
    expect(kept.result.isSuccess()).toBe(true);
    expect(discountsOf(kept.captured)).toEqual([stored]);

    const moved = await edit(
      { kind: 'move', startIso: at(12).toISO() },
      { current: document({ discounts: [stored] }), resolver },
    );
    expect(moved.result.isSuccess()).toBe(true);
    expect(discountsOf(moved.captured)).toEqual([stored]);

    const cleared = await edit(set([]), {
      current: document({ discounts: [stored] }),
      roles: ['barber'],
    });
    expect(cleared.result.isSuccess()).toBe(true);
    expect(discountsOf(cleared.captured)).toEqual([]);
  });

  it('refuses a malformed arm before anything is read', async () => {
    for (const discounts of [
      [{ source: 'manual', value: { kind: 'percent_off', percent: 12.5 } }],
      [{ source: 'manual', value: { kind: 'percent_off', percent: 140 } }],
      [
        {
          source: 'manual',
          value: { kind: 'fixed_amount', amountMinorUnits: 0 },
        },
      ],
      [{ source: 'grant', grantId: '' }],
      [{ source: 'code' }],
      [{ source: 'wishful' }],
      'nonsense',
    ]) {
      const { result, captured } = await edit(
        { kind: 'discounts', discounts } as unknown as StaffEditCommand,
        { roles: ['admin'], resolver },
      );
      expect(code(result)).toBe('booking.staffEdit.invalid_command');
      expect(captured.request).toBeUndefined();
    }
  });
});

/*
 * ── THE BILL: VOUCHERS (2026-09-10) ────────────────────────────────────
 * A gift voucher PAYS; it does not discount. Read and written inside the
 * transaction through the ledger, settled last against the bill as the
 * batch leaves it, and re-settled on every save so a shrinking bill gives
 * money back.
 */
describe('staffEditAppointment — the vouchers paying the bill', () => {
  const eur = (minor: number): Money =>
    unwrap(Money.fromMinorUnitsAndCode(minor, 'EUR'));

  function voucher(
    id: string,
    code: string,
    balance: number,
    options: {
      readonly initial?: number;
      readonly expiresAt?: ZonedDateTime | null;
      readonly state?: GiftVoucher['state'];
    } = {},
  ): GiftVoucher {
    return unwrap(
      GiftVoucher.reconstitute({
        id,
        code,
        value: eur(options.initial ?? balance),
        balance: eur(balance),
        issuedAt: at(8),
        expiresAt: options.expiresAt ?? null,
        state: options.state ?? { kind: 'active' },
      }),
    );
  }

  /** An in-memory ledger: a map of vouchers, read by id or code, written back. */
  function ledgerOf(vouchers: readonly GiftVoucher[]) {
    const state = new Map(vouchers.map((entry) => [entry.id.value, entry]));
    const ledger: VoucherLedger = {
      async read(_tx, codes, ids) {
        const found = new Map<string, GiftVoucher>();
        for (const id of ids) {
          const hit = state.get(id);
          if (hit) found.set(id, hit);
        }
        for (const raw of codes) {
          const code = Coupon.normalizeCode(raw);
          const hit = [...state.values()].find((entry) => entry.code === code);
          if (hit) found.set(hit.id.value, hit);
        }
        return ok([...found.values()]);
      },
      write(_tx, settled) {
        for (const entry of settled) state.set(entry.id.value, entry);
      },
    };
    const balance = (id: string) => state.get(id)?.balance.toMinorUnits();
    return { ledger, balance };
  }

  const redemptionsOf = (captured: { decision?: BookingDecision }) =>
    written(captured)['voucherRedemptions'] as readonly Record<
      string,
      unknown
    >[];
  const vouchers = (codes: readonly string[]): StaffEditCommand => ({
    kind: 'vouchers',
    codes,
  });

  it('draws a voucher down by what the bill needs, and records the balance it leaves', async () => {
    const { ledger, balance } = ledgerOf([voucher('v1', 'GIFT2025', 2500)]);
    const { result, captured } = await edit(vouchers([' gift2025 ']), {
      roles: ['barber'],
      ledger,
    });
    expect(result.isSuccess()).toBe(true);
    // A 40,00 € fade: the whole 25,00 € goes, 15,00 € stays owed.
    expect(redemptionsOf(captured)).toEqual([
      {
        voucherId: 'v1',
        code: 'GIFT2025',
        amountMinorUnits: 2500,
        balanceAfterMinorUnits: 0,
        currencyCode: 'EUR',
        appliedAt: { iso: at(9).toISO(), zone: ZONE },
        reversedAt: null,
      },
    ]);
    expect(captured.decision?.appointment.balanceDue().toMinorUnits()).toBe(
      1500,
    );
    expect(balance('v1')).toBe(0);
    // The price is untouched: a voucher pays, it does not discount.
    expect(captured.decision?.appointment.total().toMinorUnits()).toBe(4000);
  });

  it('covers in order, after the discounts, and stops at the bill', async () => {
    const { ledger, balance } = ledgerOf([
      voucher('v5', 'GIFT5', 500),
      voucher('v1', 'GIFT2025', 2500),
    ]);
    const resolver: DiscountResolver = {
      grant: async () => null,
      code: async (raw) =>
        Coupon.normalizeCode(raw) === 'FIRST10'
          ? {
              couponId: 'c',
              label: 'Първо посещение',
              value: unwrap(CouponValue.percentOff(10)),
              code: 'FIRST10',
              exclusive: false,
            }
          : null,
    };
    const { result, captured } = await edit(
      [
        { kind: 'discounts', discounts: [{ source: 'code', code: 'FIRST10' }] },
        vouchers(['GIFT5', 'GIFT2025']),
      ],
      { roles: ['barber'], resolver, ledger },
    );
    expect(result.isSuccess()).toBe(true);
    // 40,00 − 10% = 36,00; GIFT5 pays 5,00, GIFT2025 pays 25,00, 6,00 left.
    expect(
      redemptionsOf(captured).map((entry) => entry['amountMinorUnits']),
    ).toEqual([500, 2500]);
    expect(captured.decision?.appointment.balanceDue().toMinorUnits()).toBe(
      600,
    );
    expect(balance('v5')).toBe(0);
    expect(balance('v1')).toBe(0);

    // A bill already paid leaves nothing for a third voucher: it is not on
    // the receipt, and its balance is untouched.
    const small = ledgerOf([
      voucher('v9', 'GIFT9', 9000),
      voucher('v5', 'GIFT5', 500),
    ]);
    const paid = await edit(vouchers(['GIFT9', 'GIFT5']), {
      roles: ['barber'],
      ledger: small.ledger,
    });
    expect(paid.result.isSuccess()).toBe(true);
    expect(redemptionsOf(paid.captured)).toHaveLength(1);
    expect(small.balance('v9')).toBe(5000);
    expect(small.balance('v5')).toBe(500);
  });

  it('re-settles a saved draw when the bill shrinks, and gives everything back when the voucher is dropped', async () => {
    const stored = {
      voucherId: 'v1',
      code: 'GIFT2025',
      amountMinorUnits: 2500,
      balanceAfterMinorUnits: 0,
      currencyCode: 'EUR',
      appliedAt: { iso: at(8).toISO(), zone: ZONE },
      reversedAt: null,
    };
    // The voucher is EMPTY — this visit emptied it — yet the visit may
    // shrink its own draw: a reprice to 10,00 € hands 15,00 € back, with
    // nothing about vouchers in the batch.
    const shrunk = ledgerOf([voucher('v1', 'GIFT2025', 0, { initial: 2500 })]);
    const repriced = await edit(
      { kind: 'reprice', seatId: 'seat-1', priceMinorUnits: 1000 },
      {
        current: document({ voucherRedemptions: [stored] }),
        roles: ['admin'],
        ledger: shrunk.ledger,
      },
    );
    expect(repriced.result.isSuccess()).toBe(true);
    expect(redemptionsOf(repriced.captured)).toEqual([
      { ...stored, amountMinorUnits: 1000, balanceAfterMinorUnits: 1500 },
    ]);
    expect(shrunk.balance('v1')).toBe(1500);
    expect(
      repriced.captured.decision?.appointment.balanceDue().toMinorUnits(),
    ).toBe(0);

    // Dropped: the line closes as history, the money is back in full.
    const dropped = ledgerOf([voucher('v1', 'GIFT2025', 0, { initial: 2500 })]);
    const cleared = await edit(vouchers([]), {
      current: document({ voucherRedemptions: [stored] }),
      roles: ['barber'],
      ledger: dropped.ledger,
    });
    expect(cleared.result.isSuccess()).toBe(true);
    expect(redemptionsOf(cleared.captured)).toEqual([
      { ...stored, reversedAt: { iso: at(9).toISO(), zone: ZONE } },
    ]);
    expect(dropped.balance('v1')).toBe(2500);
    expect(
      cleared.captured.decision?.appointment.balanceDue().toMinorUnits(),
    ).toBe(4000);
  });

  it('refuses a code that opens nothing, and a voucher spent, expired, void, or named twice', async () => {
    const { ledger } = ledgerOf([
      voucher('empty', 'EMPTY001', 0, { initial: 1000 }),
      voucher('late', 'LATE0001', 1000, { expiresAt: at(7) }),
      voucher('gone', 'GONE0001', 1000, {
        state: { kind: 'void', voidedAt: at(7), reason: 'lost' },
      }),
      voucher('ok', 'GIFT5', 500),
    ]);
    for (const codes of [
      ['NOPE1234'],
      ['EMPTY001'],
      ['LATE0001'],
      ['GONE0001'],
      ['GIFT5', 'gift5'],
    ]) {
      const { result, captured } = await edit(vouchers(codes), {
        roles: ['barber'],
        ledger,
      });
      expect(code(result)).toBe('booking.staffEdit.invalid_command');
      expect(captured.decision).toBeUndefined();
    }
  });
});
