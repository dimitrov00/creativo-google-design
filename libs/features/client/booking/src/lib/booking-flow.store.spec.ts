import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { TestBed } from '@angular/core/testing';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BarberPref,
  type BookingDraft,
  type BookingGateway,
  BookingGatewayError,
  type CommitBookingRequest,
  type CommittedBooking,
  Money,
  type Result,
  ScheduleSelection,
  Seat,
  SeatId,
  SeatKey,
  SeatLabel,
  SeatSubject,
  TimeSlot,
  WAITLIST_GATEWAY,
  WaitlistGatewayError,
  WaitlistRequest,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/application/booking';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
import { UserId } from '@creativo/application/accounts';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { BookingFlowStore, firstUnusedLabel } from './booking-flow.store';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const at = (hour: number) =>
  unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute: 0 },
      ZONE,
    ),
  );

/** A gateway whose answer this spec chooses. */
class StubGateway implements BookingGateway {
  answer: Result<CommittedBooking, BookingGatewayError> = ok({
    appointmentId: 'appt-1',
  });
  calls: CommitBookingRequest[] = [];

  async commit(
    request: CommitBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>> {
    this.calls.push(request);
    return this.answer;
  }

  // The flow store only ever commits; the rest of the port exists for the
  // staff surfaces and is out of this double's reach on purpose — reaching
  // one here means the test drifted into someone else's use case.
  cancel(): never {
    throw new Error('not under test');
  }
  reschedule(): never {
    throw new Error('not under test');
  }
  transition(): never {
    throw new Error('not under test');
  }
  markArrived(): never {
    throw new Error('not under test');
  }
  clearArrival(): never {
    throw new Error('not under test');
  }
  recordTip(): never {
    throw new Error('not under test');
  }

  staffEdit(): never {
    throw new Error('not under test');
  }
}

/** `sessionStorage` is not worth doubling here — the flow is what's under test. */
const NULL_DRAFT_STORE = {
  load: () => ok(null),
  save: () => ok(undefined),
  clear: () => ok(undefined),
};

/** Records what the waitlist was asked to watch, and answers as told. */
class StubWaitlistGateway {
  answer: Result<{ requestId: string }, WaitlistGatewayError> = ok({
    requestId: 'wl-1',
  });
  calls: unknown[] = [];

  async request(
    input: unknown,
  ): Promise<Result<{ requestId: string }, WaitlistGatewayError>> {
    this.calls.push(input);
    return this.answer;
  }

  async cancel(): Promise<Result<void, WaitlistGatewayError>> {
    return ok(undefined);
  }
}

/** The owner-scoped visit read: answers as told, and counts the reads. */
class StubAppointments {
  answer: Result<Appointment | null, RepositoryError> = ok(null);
  reads = 0;

  async findById(): Promise<Result<Appointment | null, RepositoryError>> {
    this.reads += 1;
    return this.answer;
  }
}

/** A `sessionStorage` stand-in that keeps one draft, JSON round trip and all. */
class MemoryDraftStore {
  private stored: string | null = null;
  load = () => ok(this.stored === null ? null : JSON.parse(this.stored));
  save = (draft: BookingDraft) => {
    this.stored = JSON.stringify(draft);
    return ok(undefined);
  };
  clear = () => {
    this.stored = null;
    return ok(undefined);
  };
}

function createStore(
  gateway: StubGateway,
  waitlist: StubWaitlistGateway = new StubWaitlistGateway(),
  draftStore: object = NULL_DRAFT_STORE,
  appointments: StubAppointments = new StubAppointments(),
): BookingFlowStore {
  TestBed.configureTestingModule({
    providers: [
      { provide: BOOKING_DRAFT_STORE, useValue: draftStore },
      { provide: BOOKING_GATEWAY, useValue: gateway },
      { provide: WAITLIST_GATEWAY, useValue: waitlist },
      { provide: APPOINTMENT_REPOSITORY, useValue: appointments },
      // Fixed, not the system clock: the store reads it to prune a restored
      // declaration's lapsed days, and a spec whose meaning changes at
      // midnight is a spec that fails once a day.
      {
        provide: CLOCK,
        useValue: {
          now: (zone: string) =>
            ZonedDateTime.fromISO('2026-08-03T09:00:00.000+03:00', zone),
        },
      },
      BookingFlowStore,
    ],
  });
  return TestBed.inject(BookingFlowStore);
}

/**
 * Walk a store to `review` the way a person does: a guest, a line EACH, a day,
 * a time. Anything shorter would be testing a state nobody can reach — and the
 * "each" is load-bearing now that the machine refuses to leave the services
 * step while anyone in the party is booking nothing. This walk used to add the
 * guest and then give a line only to the booker, which is precisely the
 * booking that silently dropped Maria somewhere before the wire.
 */
function walkToReview(store: BookingFlowStore): ScheduleSelection {
  // Step 1 is WHERE, and it is optional — this walk takes the explicit shop.
  store.selectLocation(unwrap(LocationId.create('loc-center')));
  store.next();

  store.addGuest('Maria');

  store.addLine(SeatKey.self(), {
    serviceId: unwrap(ServiceId.create('svc-fade')),
    variantId: null,
    barberPref: BarberPref.any(),
  });
  const guest = store.guests()[0];
  if (!guest) throw new Error('fixture setup failed: no guest');
  store.addLine(SeatKey.guest(guest.id), {
    serviceId: unwrap(ServiceId.create('svc-beard')),
    variantId: null,
    barberPref: BarberPref.any(),
  });
  store.next();

  store.selectDay('2026-08-03', ZONE);
  store.selectStart(at(12).toMillis(), 'loc-center');

  const slot = unwrap(TimeSlot.of(at(12), at(13)));
  // Both seats, served in parallel — the envelope is the longer of the two,
  // which for one hour each is the hour.
  const assignments = (store.cart()?.entries() ?? [])
    .flatMap(([, lines]) => lines)
    .map((line) => {
      const lineId = store.cartLineId(line.id.value);
      if (!lineId) throw new Error('fixture setup failed: line went missing');
      return { lineId, barberId: unwrap(BarberId.create('ivan')), slot };
    });

  const selection: ScheduleSelection = {
    locationId: unwrap(LocationId.create('loc-center')),
    timeSlot: slot,
    assignments,
  };
  store.selectSchedule(selection);
  return selection;
}

describe('BookingFlowStore — commit', () => {
  let gateway: StubGateway;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = new StubGateway();
    store = createStore(gateway);
  });

  it('sends WHAT and WHO, and never a price or a duration', async () => {
    walkToReview(store);
    await store.commit();

    const [request] = gateway.calls;
    // One per seat — the guest travels too, as a LABEL, because that is all a
    // party member is until they have an account of their own.
    expect(request?.seats).toHaveLength(2);
    // The guest's seat key rides beside the label, so the server can tell
    // two DIFFERENT guests under one name from one guest with two services.
    expect(request?.seats.map((seat) => seat.subject)).toEqual([
      { kind: 'self' },
      { kind: 'guest', label: 'Maria', guestKey: 'guest-0' },
    ]);
    // Read as a loose bag on purpose: the assertion is that these keys do
    // not EXIST on the wire, which the typed shape cannot express.
    const seat = request?.seats[0] as unknown as Record<string, unknown>;
    // The server resolves terms. A client that could name its own price
    // would book a 40 € fade for nothing.
    expect(seat['priceMinorUnits']).toBeUndefined();
    expect(seat['durationMinutes']).toBeUndefined();
    expect(seat['barberId']).toBe('ivan');
    expect(seat['subject']).toEqual({ kind: 'self' });
  });

  it('lands on `confirmed` with the server’s appointment id', async () => {
    walkToReview(store);
    await store.commit();

    expect(store.step()).toBe('confirmed');
    expect(store.confirmation()?.appointmentId).toBe('appt-1');
  });

  it('bounces BACK to the schedule when the slot was taken — keeping the day', async () => {
    // The one recoverable failure. The user should land on a fresh grid on
    // the day they already chose, not at the start of the wizard.
    walkToReview(store);
    gateway.answer = fail(new BookingGatewayError('slot_unavailable', 'gone'));

    await store.commit();

    expect(store.step()).toBe('schedule');
    expect(store.slotTaken()).toBe(true);
    expect(store.selectedDayKey()).toBe('2026-08-03');
    // …but NOT the time it can no longer honour.
    expect(store.selectedStartMs()).toBeNull();
    // The bag and the party survive — nothing about a lost race invalidates them.
    expect(store.lineCount()).toBe(2);
    expect(store.guests()).toHaveLength(1);
  });

  it('STAYS on review for a failure re-picking a time cannot fix', async () => {
    walkToReview(store);
    gateway.answer = fail(
      new BookingGatewayError('catalog_changed', 'service withdrawn'),
    );

    await store.commit();

    expect(store.step()).toBe('review');
    expect(store.slotTaken()).toBe(false);
    expect(store.error()).not.toBeNull();
  });

  it('refuses to double-submit while a commit is in flight', async () => {
    walkToReview(store);
    const first = store.commit();
    const second = store.commit();
    await Promise.all([first, second]);

    expect(gateway.calls).toHaveLength(1);
  });

  it('does nothing at all outside the review step', async () => {
    await store.commit();

    expect(gateway.calls).toHaveLength(0);
    expect(store.step()).toBe('location');
  });

  it('REFUSES the same service twice for one person', () => {
    // You cannot have two haircuts in one visit; the party is what makes a
    // second haircut expressible, and it belongs to a different seat.
    store.selectLocation(null);
    store.next();
    store.addGuest('Maria');
    store.next();

    const cut = {
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberPref: BarberPref.any(),
    };
    store.addLine({ kind: 'self' }, cut);
    store.addLine({ kind: 'self' }, cut);
    expect(store.lineCount()).toBe(1);

    // …but the SAME service for the guest is the ordinary case.
    store.addLine({ kind: 'guest', guestId: store.guests()[0]!.id }, cut);
    expect(store.lineCount()).toBe(2);
  });

  it('treats "any shop" as an answer — the first step never blocks', () => {
    // `null` is a choice, not an absence, so `next` has no precondition to fail.
    store.selectLocation(null);
    store.next();

    expect(store.step()).toBe('services');
    expect(store.locationId()).toBeNull();
  });
});

/** A visit to book again: the booker's fade with Ivan at the Center. */
function visit(id: string, booker = 'client-1'): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(unwrap(UserId.create(booker)), 'self'),
          serviceId: unwrap(ServiceId.create('svc-fade')),
          variantId: null,
          barberId: unwrap(BarberId.create('ivan')),
          terms: unwrap(ServiceTerms.create(price, 45)),
          startsAt: at(10),
        }),
      ],
      now: at(8),
    }),
  );
}

const guestLabel = (ordinal: number): string => `Guest ${ordinal}`;

/** From the schedule step a repeat lands on, to review: Ivan at 12:00. */
function armSchedule(store: BookingFlowStore): void {
  store.selectDay('2026-08-03', ZONE);
  store.selectStart(at(12).toMillis(), 'loc-center');
  const slot = unwrap(TimeSlot.of(at(12), at(13)));
  store.selectSchedule({
    locationId: unwrap(LocationId.create('loc-center')),
    timeSlot: slot,
    assignments: (store.cart()?.entries() ?? [])
      .flatMap(([, lines]) => lines)
      .map((line) => ({
        lineId: line.id,
        barberId: unwrap(BarberId.create('ivan')),
        slot,
      })),
  });
}

// Defect §2.3 #6: `/book?repeat=` rebuilt the bag and then dropped the visit
// it came from, so every rebooking landed with `bookedFrom: null` — a fact
// no backfill can recover.
describe('BookingFlowStore — the rebooking edge', () => {
  let gateway: StubGateway;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = new StubGateway();
    store = createStore(gateway);
  });

  it('sends the visit a repeat started from as `bookedFromAppointmentId`', async () => {
    expect(store.repeat(visit('appt-source'), guestLabel)).toBe(true);
    expect(store.step()).toBe('schedule');

    armSchedule(store);
    await store.commit();

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.bookedFromAppointmentId).toBe('appt-source');
  });

  it('sends no edge at all on a cold booking', async () => {
    walkToReview(store);
    await store.commit();

    const [request] = gateway.calls;
    if (!request) throw new Error('nothing was committed');
    // Absent, not `null`: a cold booking says nothing about where it came from.
    expect('bookedFromAppointmentId' in request).toBe(false);
    expect(store.bookedFrom()).toBeNull();
  });

  it('keeps the edge through an edited bag and a lost race', async () => {
    store.repeat(visit('appt-source'), guestLabel);
    // A beard added on the services step is still a booking made from that
    // visit.
    store.back();
    store.addLine(SeatKey.self(), {
      serviceId: unwrap(ServiceId.create('svc-beard')),
      variantId: null,
      barberPref: BarberPref.any(),
    });
    store.next();
    expect(store.lineCount()).toBe(2);

    armSchedule(store);
    gateway.answer = fail(new BookingGatewayError('slot_unavailable', 'gone'));
    await store.commit();
    expect(store.step()).toBe('schedule');

    gateway.answer = ok({ appointmentId: 'appt-2' });
    armSchedule(store);
    await store.commit();

    expect(
      gateway.calls.map((request) => request.bookedFromAppointmentId),
    ).toEqual(['appt-source', 'appt-source']);
  });

  it('never marks a move as a rebooking', () => {
    // A reschedule keeps its own appointment; it is not a booking made from
    // one, and its request has no such field to carry.
    store.repeat(visit('appt-earlier'), guestLabel);
    expect(
      store.rescheduleFrom(visit('appt-moving'), guestLabel).isSuccess(),
    ).toBe(true);

    expect(store.isRescheduling()).toBe(true);
    expect(store.bookedFrom()).toBeNull();
  });
});

/**
 * A father, his son (an ACCOUNT staff seated beside him) and a guest with two
 * services — the party a prefill has to keep straight.
 */
function partyVisit(id: string): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = (
    subject: SeatSubject,
    barberId: string,
    serviceId: string,
    start: ZonedDateTime,
  ) =>
    Seat.of({
      id: SeatId.generate(),
      subject,
      serviceId: unwrap(ServiceId.create(serviceId)),
      variantId: null,
      barberId: unwrap(BarberId.create(barberId)),
      terms: unwrap(ServiceTerms.create(price, 45)),
      startsAt: start,
    });
  const maria = SeatSubject.anonymous(unwrap(SeatLabel.create('Мария')));
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat(
          SeatSubject.account(unwrap(UserId.create('client-1')), 'self'),
          'ivan',
          'svc-fade',
          at(10),
        ),
        seat(
          SeatSubject.account(unwrap(UserId.create('client-son')), 'companion'),
          'petar',
          'svc-fade',
          at(10),
        ),
        seat(maria, 'stefan', 'svc-fade', at(10)),
        seat(maria, 'stefan', 'svc-beard', at(11)),
      ],
      now: at(8),
    }),
  );
}

/**
 * A visit left holding only the son — staff removed the father's own seat
 * when he could not come. Nobody on it is the cart's to name.
 */
function companionOnlyVisit(id: string): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2000, 'EUR'));
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(
            unwrap(UserId.create('client-son')),
            'companion',
          ),
          serviceId: unwrap(ServiceId.create('svc-beard')),
          variantId: null,
          barberId: unwrap(BarberId.create('petar')),
          terms: unwrap(ServiceTerms.create(price, 30)),
          startsAt: at(10),
        }),
      ],
      now: at(8),
    }),
  );
}

/** The father at 10:00 with Ivan, and his son straight after, same chair. */
function sequentialVisit(id: string): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = (
    subject: SeatSubject,
    serviceId: string,
    start: ZonedDateTime,
  ) =>
    Seat.of({
      id: SeatId.generate(),
      subject,
      serviceId: unwrap(ServiceId.create(serviceId)),
      variantId: null,
      barberId: unwrap(BarberId.create('ivan')),
      terms: unwrap(ServiceTerms.create(price, 45)),
      startsAt: start,
    });
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat(
          SeatSubject.account(unwrap(UserId.create('client-1')), 'self'),
          'svc-fade',
          at(10),
        ),
        seat(
          SeatSubject.account(unwrap(UserId.create('client-son')), 'companion'),
          'svc-beard',
          at(10).plusMinutes(45),
        ),
      ],
      now: at(8),
    }),
  );
}

/**
 * The booker at 10:00 with Ivan, and a companion the shop seated with Petar
 * fifteen minutes EARLIER, on hand-set terms with setup and cleanup.
 */
function padsVisit(id: string): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(
            unwrap(UserId.create('client-1')),
            'self',
          ),
          serviceId: unwrap(ServiceId.create('svc-fade')),
          variantId: null,
          barberId: unwrap(BarberId.create('ivan')),
          terms: unwrap(ServiceTerms.create(price, 45)),
          startsAt: at(10),
        }),
        Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(
            unwrap(UserId.create('client-son')),
            'companion',
          ),
          serviceId: unwrap(ServiceId.create('svc-beard')),
          variantId: null,
          barberId: unwrap(BarberId.create('petar')),
          terms: unwrap(
            ServiceTerms.create(price, 30, {
              setupMinutes: 5,
              cleanupMinutes: 10,
            }),
          ),
          startsAt: at(10).plusMinutes(-15),
        }),
      ],
      now: at(8),
    }),
  );
}

/**
 * The booker at 10:00, and a seat that says `self` for ANOTHER account right
 * after — a stored shape the client's cart cannot speak for.
 */
function foreignSelfVisit(id: string): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = (userId: string, barberId: string, start: ZonedDateTime) =>
    Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.account(unwrap(UserId.create(userId)), 'self'),
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberId: unwrap(BarberId.create(barberId)),
      terms: unwrap(ServiceTerms.create(price, 45)),
      startsAt: start,
    });
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat('client-1', 'ivan', at(10)),
        seat('client-other', 'petar', at(11)),
      ],
      now: at(8),
    }),
  );
}

/**
 * The booker, plus two anonymous seats under ONE label — side by side with
 * two barbers, or back to back with one — and a third guest under another.
 */
function sharedLabelVisit(
  id: string,
  arrangement: 'side_by_side' | 'back_to_back',
): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = (
    subject: SeatSubject,
    barberId: string,
    serviceId: string,
    start: ZonedDateTime,
  ) =>
    Seat.of({
      id: SeatId.generate(),
      subject,
      serviceId: unwrap(ServiceId.create(serviceId)),
      variantId: null,
      barberId: unwrap(BarberId.create(barberId)),
      terms: unwrap(ServiceTerms.create(price, 45)),
      startsAt: start,
    });
  const walkIn = SeatSubject.anonymous(unwrap(SeatLabel.create('Walk-in')));
  const maria = SeatSubject.anonymous(unwrap(SeatLabel.create('Мария')));
  const second =
    arrangement === 'side_by_side'
      ? seat(walkIn, 'petar', 'svc-beard', at(12))
      : seat(walkIn, 'stefan', 'svc-beard', at(13));
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat(
          SeatSubject.account(unwrap(UserId.create('client-1')), 'self'),
          'ivan',
          'svc-fade',
          at(10),
        ),
        seat(walkIn, 'stefan', 'svc-fade', at(12)),
        second,
        seat(maria, 'ivan', 'svc-fade', at(11)),
      ],
      now: at(8),
    }),
  );
}

/**
 * The booker, and one guest under the name the visit stored — optionally with
 * a companion ACCOUNT (no name of his own) seated first.
 */
function labelledGuestVisit(
  id: string,
  label: string,
  options: { readonly withCompanion?: boolean } = {},
): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = (subject: SeatSubject, barberId: string) =>
    Seat.of({
      id: SeatId.generate(),
      subject,
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberId: unwrap(BarberId.create(barberId)),
      terms: unwrap(ServiceTerms.create(price, 45)),
      startsAt: at(10),
    });
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat(
          SeatSubject.account(unwrap(UserId.create('client-1')), 'self'),
          'ivan',
        ),
        ...(options.withCompanion
          ? [
              seat(
                SeatSubject.account(
                  unwrap(UserId.create('client-son')),
                  'companion',
                ),
                'petar',
              ),
            ]
          : []),
        seat(SeatSubject.anonymous(unwrap(SeatLabel.create(label))), 'stefan'),
      ],
      now: at(8),
    }),
  );
}

function linesPerPerson(store: BookingFlowStore): number[] {
  return (store.cart()?.entries() ?? []).map(([, lines]) => lines.length);
}

describe('BookingFlowStore — who a prefilled bag holds', () => {
  let gateway: StubGateway;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = new StubGateway();
    store = createStore(gateway);
  });

  it('leaves a companion ACCOUNT out of a move — the server carries them, so no phantom guest', () => {
    expect(
      store.rescheduleFrom(partyVisit('appt-moving'), guestLabel).isSuccess(),
    ).toBe(true);

    // The father and Maria; the son is NOT re-created as a nameless guest.
    expect(store.guests()).toHaveLength(1);
    expect(linesPerPerson(store)).toEqual([1, 2]);
  });

  it('offers the companion as a guest on a repeat — a new booking cannot seat an account', () => {
    expect(store.repeat(partyVisit('appt-source'), guestLabel)).toBe(true);

    expect(store.guests()).toHaveLength(2);
    expect(linesPerPerson(store)).toEqual([1, 1, 2]);
  });

  it('keeps a guest with two services ONE person, as the server counts them', () => {
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const [maria] = store.guests();
    // Under the name the visit stored for her, not a placeholder.
    expect(maria?.label.value).toBe('Мария');
    expect(store.lineCount()).toBe(3);
  });

  it('keeps the name the SHOP gave a guest through a move, and sends it — never «Guest 1» over it', async () => {
    const moves: { seats: { subject: { kind: string; label?: string } }[] }[] =
      [];
    Object.assign(gateway, {
      reschedule: async (request: (typeof moves)[number]) => {
        moves.push(request);
        return ok({ appointmentId: 'appt-moving' });
      },
    });
    store.claim('client-1');
    store.rescheduleFrom(
      labelledGuestVisit('appt-moving', 'Иван (син)'),
      guestLabel,
    );
    expect(store.guests().map((guest) => guest.label.value)).toEqual([
      'Иван (син)',
    ]);

    armSchedule(store);
    await store.commit();
    // The label the server matches its stored seat by (`personKey`, the
    // replay check) — the one it already holds.
    expect(
      moves[0]?.seats
        .map((seat) => seat.subject.label)
        .filter((label) => label !== undefined),
    ).toEqual(['Иван (син)']);
  });

  it('keeps the stored names on a repeat too, and numbers a nameless companion around them', () => {
    // A companion ACCOUNT has no label, so on a repeat he needs a
    // placeholder — and «Guest 1» is already somebody's stored name.
    store.repeat(
      labelledGuestVisit('appt-source', 'Guest 1', { withCompanion: true }),
      guestLabel,
    );

    expect(store.guests().map((guest) => guest.label.value)).toEqual([
      'Guest 2',
      'Guest 1',
    ]);
  });

  it('never hands a guest added later a name a prefilled guest already has', () => {
    store.rescheduleFrom(
      labelledGuestVisit('appt-moving', 'Guest 3'),
      guestLabel,
    );
    // The services step numbers from past the highest guest id — 3 here.
    expect(store.unusedGuestLabel(guestLabel, 3)).toBe('Guest 4');
    expect(store.unusedGuestLabel(guestLabel, 1)).toBe('Guest 1');
  });

  it('sends the move without the companion — only the seats the cart can express', async () => {
    const moves: unknown[] = [];
    Object.assign(gateway, {
      reschedule: async (request: unknown) => {
        moves.push(request);
        return ok({ appointmentId: 'appt-moving' });
      },
    });
    store.claim('client-1');
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    armSchedule(store);
    await store.commit();

    expect(gateway.calls).toHaveLength(0);
    expect(moves).toHaveLength(1);
    const [move] = moves as {
      appointmentId: string;
      seats: { subject: { kind: string } }[];
    }[];
    expect(move?.appointmentId).toBe('appt-moving');
    expect(move?.seats.map((seat) => seat.subject.kind).sort()).toEqual([
      'guest',
      'guest',
      'self',
    ]);
  });

  // A guest's LABEL is its only identity, and the server counts people by it
  // (`personKey`). Two seats under one label are therefore ONE person on both
  // sides — however they were arranged. Pinned here on purpose: two DIFFERENT
  // people sharing a label (the staff sheet's walk-in default) is a defect
  // at that source, and this spec is what will change if it is fixed here
  // instead.
  for (const arrangement of ['side_by_side', 'back_to_back'] as const) {
    it(`reads two guests under ONE label as one person with both services — ${arrangement}, move and repeat alike`, () => {
      store.claim('client-1');
      store.rescheduleFrom(
        sharedLabelVisit('appt-moving', arrangement),
        guestLabel,
      );
      expect(store.guests()).toHaveLength(2);
      expect(linesPerPerson(store)).toEqual([1, 2, 1]);

      store.repeat(sharedLabelVisit('appt-source', arrangement), guestLabel);
      expect(store.guests()).toHaveLength(2);
      expect(linesPerPerson(store)).toEqual([1, 2, 1]);
    });
  }

  it('sends both of that person’s seats under ONE label — the reading the server’s `personKey` agrees with', async () => {
    const moves: { seats: { subject: { kind: string; label?: string } }[] }[] =
      [];
    Object.assign(gateway, {
      reschedule: async (request: (typeof moves)[number]) => {
        moves.push(request);
        return ok({ appointmentId: 'appt-moving' });
      },
    });
    store.claim('client-1');
    store.rescheduleFrom(
      sharedLabelVisit('appt-moving', 'side_by_side'),
      guestLabel,
    );
    armSchedule(store);
    await store.commit();

    const labels = (moves[0]?.seats ?? [])
      .map((seat) => seat.subject.label)
      .filter((label): label is string => label !== undefined)
      .sort();
    // The walk-in holds both of their lines, under the one stored name.
    expect(labels).toEqual(['Walk-in', 'Walk-in', 'Мария']);
  });

  it('keeps guests under DIFFERENT labels different people', () => {
    store.repeat(sharedLabelVisit('appt-source', 'back_to_back'), guestLabel);

    // The walk-in and Мария: two people, never merged by position or time.
    expect(store.guests().map((guest) => guest.label.value)).toEqual([
      'Walk-in',
      'Мария',
    ]);
  });
});

describe('BookingFlowStore — one label, one guest', () => {
  it('answers whether a rename was taken, and holds WHY it was not', () => {
    const store = createStore(new StubGateway());
    store.selectLocation(null);
    store.next();
    store.addGuest('Maria');
    store.addGuest('Guest 2');
    const [maria, second] = store.guests();
    if (!maria || !second) throw new Error('fixture setup failed');

    expect(store.renameGuest(second.id, 'Maria')).toBe(false);
    expect(store.error()?.code).toBe(
      'scheduling.booking_party.duplicate_label',
    );
    expect(store.guests().map((guest) => guest.label.value)).toEqual([
      'Maria',
      'Guest 2',
    ]);

    expect(store.renameGuest(second.id, 'Ivan')).toBe(true);
    expect(store.error()).toBeNull();
    expect(store.guests().map((guest) => guest.label.value)).toEqual([
      'Maria',
      'Ivan',
    ]);
  });
});

/*
 * A MOVE NAMES ITS ATTEMPT (round 3). The server keys a move's audit rows by
 * the attempt id, so a retry whose first attempt landed fills a lost row
 * instead of logging nothing — which only works if the client sends it.
 */
describe('BookingFlowStore — a move names its attempt, like a commit', () => {
  let gateway: StubGateway;
  let store: BookingFlowStore;
  let moves: { attemptId?: string }[];

  beforeEach(() => {
    gateway = new StubGateway();
    store = createStore(gateway);
    moves = [];
    Object.assign(gateway, {
      reschedule: async (request: { attemptId?: string }) => {
        moves.push(request);
        return moves.length === 1
          ? fail(new BookingGatewayError('unavailable', 'offline'))
          : ok({ appointmentId: 'appt-moving' });
      },
    });
    store.claim('client-1');
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
  });

  it('sends the armed selection’s attempt id with the move, and the SAME one on a retry', async () => {
    armSchedule(store);
    await store.commit(); // lost to the network — stays on review
    expect(store.step()).toBe('review');
    await store.commit(); // the retry of the same selection

    expect(moves).toHaveLength(2);
    const [first, retry] = moves;
    expect(first?.attemptId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(retry?.attemptId).toBe(first?.attemptId);
    expect(gateway.calls).toHaveLength(0);
  });

  it('mints a NEW attempt id for a new selection — a new pick is a new attempt', async () => {
    armSchedule(store);
    await store.commit();
    store.back();
    armSchedule(store);
    await store.commit();

    const [first, second] = moves;
    expect(second?.attemptId).toBeDefined();
    expect(second?.attemptId).not.toBe(first?.attemptId);
  });
});

/**
 * A `?reschedule=` link binds the flow to THAT move. Every way it cannot
 * become one is said, and none of them may end as a second booking.
 */
describe('BookingFlowStore — a move the cart cannot make', () => {
  let gateway: StubGateway;
  let store: BookingFlowStore;
  let moves: unknown[];

  beforeEach(() => {
    gateway = new StubGateway();
    moves = [];
    Object.assign(gateway, {
      reschedule: async (request: unknown) => {
        moves.push(request);
        return ok({ appointmentId: 'appt-moving' });
      },
    });
    store = createStore(gateway);
  });

  it('refuses a visit that holds nobody but a companion — no bag, no move, and says why', () => {
    const result = store.rescheduleFrom(
      companionOnlyVisit('appt-son'),
      guestLabel,
    );

    expect(result.isFailure() && result.error).toBe('companions_only');
    expect(store.moveRefusal()?.reason).toBe('companions_only');
    // The shop it is at — what the refusal's call button dials.
    expect(store.moveRefusal()?.locationId?.value).toBe('loc-center');
    expect(store.isRescheduling()).toBe(false);
    // Nothing was prefilled: the son is not turned into a guest to move.
    expect(store.lineCount()).toBe(0);
    expect(store.step()).toBe('location');
  });

  it('never commits a move link as a new booking — not while the visit loads, not once it is refused', async () => {
    store.expectMove('appt-son');
    walkToReview(store);

    // Still loading: there is no move to send yet, and no new booking either.
    await store.commit();
    expect(gateway.calls).toHaveLength(0);
    expect(moves).toHaveLength(0);
    expect(store.error()).not.toBeNull();

    // Refused: the same, for good.
    store.rescheduleFrom(companionOnlyVisit('appt-son'), guestLabel);
    await store.commit();
    expect(gateway.calls).toHaveLength(0);
    expect(moves).toHaveLength(0);
  });

  it('commits the move once the visit it was opened for has landed', async () => {
    store.claim('client-1');
    store.expectMove('appt-moving');
    expect(
      store.rescheduleFrom(visit('appt-moving'), guestLabel).isSuccess(),
    ).toBe(true);
    armSchedule(store);
    await store.commit();

    expect(gateway.calls).toHaveLength(0);
    expect(moves).toHaveLength(1);
    expect(store.moveRefusal()).toBeNull();
  });

  it('keeps who the server carries, at their distance from the booker — side by side, or straight after', () => {
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    expect(store.riders()).toEqual([
      {
        serviceId: 'svc-fade',
        variantId: null,
        barberId: 'petar',
        offsetMinutes: 0,
        durationMinutes: 45,
        setupMinutes: 0,
        cleanupMinutes: 0,
      },
    ]);

    store.rescheduleFrom(sequentialVisit('appt-moving'), guestLabel);
    expect(store.riders()).toEqual([
      {
        serviceId: 'svc-beard',
        variantId: null,
        barberId: 'ivan',
        offsetMinutes: 45,
        durationMinutes: 45,
        setupMinutes: 0,
        cleanupMinutes: 0,
      },
    ]);
  });

  it('hands the schedule step every rider as the engine takes it — pinned, on their own barber and SOLD terms', () => {
    // Nothing to keep room for on a new booking.
    store.repeat(padsVisit('appt-source'), guestLabel);
    expect(store.availabilityRiders()).toEqual([]);

    store.rescheduleFrom(padsVisit('appt-moving'), guestLabel);
    const [pinned, ...rest] = store.availabilityRiders();
    expect(rest).toEqual([]);
    expect(pinned?.barberId.value).toBe('petar');
    // …and WHAT he is served: a shop that does not offer his beard has no
    // time for this move, and the day query can only tell by the service.
    expect(pinned?.serviceId.value).toBe('svc-beard');
    // The son goes fifteen minutes BEFORE the booker the move is measured from.
    expect(pinned?.offsetMinutes).toBe(-15);
    // The seat's stored chair time, pads and all — what the server re-checks.
    expect(pinned?.terms).toEqual({
      durationMinutes: 30,
      padBeforeMinutes: 5,
      padAfterMinutes: 10,
    });
  });

  it('carries a `self` seat bound to ANOTHER account, exactly like a companion — the server’s own rule', () => {
    store.claim('client-1');
    expect(
      store
        .rescheduleFrom(foreignSelfVisit('appt-moving'), guestLabel)
        .isSuccess(),
    ).toBe(true);

    // The booker alone in the bag; the foreign `self` rides along.
    expect(store.guests()).toHaveLength(0);
    expect(linesPerPerson(store)).toEqual([1]);
    expect(store.riders().map((rider) => rider.barberId)).toEqual(['petar']);
  });

  it('offers a foreign `self` seat as a GUEST on a repeat — never as the booker a second time', () => {
    store.claim('client-1');
    expect(store.repeat(foreignSelfVisit('appt-source'), guestLabel)).toBe(
      true,
    );

    expect(store.guests()).toHaveLength(1);
    expect(linesPerPerson(store)).toEqual([1, 1]);
  });

  it('hands back the visit’s OWN chairs — every seat, pads included — so they never block its move', () => {
    // Nothing to release on a new booking.
    store.repeat(padsVisit('appt-source'), guestLabel);
    expect(store.moveRelease()).toEqual([]);

    store.rescheduleFrom(padsVisit('appt-moving'), guestLabel);
    expect(
      store.moveRelease().map((chair) => ({
        barberId: chair.barberId.value,
        startMs: chair.occupied.startMs,
        endMs: chair.occupied.endMs,
      })),
    ).toEqual([
      // The booker's fade with Ivan, the seat the cart rebuilds…
      {
        barberId: 'ivan',
        startMs: at(10).toMillis(),
        endMs: at(10).plusMinutes(45).toMillis(),
      },
      // …and the son's beard the move carries, setup and cleanup included:
      // the server subtracts the whole visit before it re-places it.
      {
        barberId: 'petar',
        startMs: at(10).plusMinutes(-20).toMillis(),
        endMs: at(10).plusMinutes(25).toMillis(),
      },
    ]);
  });

  it('has no riders on a new booking, or on a move with nobody to carry', () => {
    store.repeat(partyVisit('appt-source'), guestLabel);
    expect(store.riders()).toEqual([]);

    store.rescheduleFrom(visit('appt-moving'), guestLabel);
    expect(store.riders()).toEqual([]);
  });
});

// The review step's sign-in round trip returns to `/book?step=schedule` —
// without the `?repeat=` that set the edge — and a new store restores the
// draft. The edge must come back with it, for the account that read the
// visit and for nobody else.
describe('BookingFlowStore — the sources survive the sign-in round trip', () => {
  let drafts: MemoryDraftStore;

  beforeEach(() => {
    drafts = new MemoryDraftStore();
  });

  /** The same tab after the round trip: a fresh store over the same draft. */
  function afterRoundTrip(gateway = new StubGateway()): BookingFlowStore {
    TestBed.resetTestingModule();
    const store = createStore(gateway, new StubWaitlistGateway(), drafts);
    store.restore();
    return store;
  }

  it('commits the restored rebooking edge for the same account', async () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.repeat(visit('appt-source'), guestLabel);
    armSchedule(before);

    const gateway = new StubGateway();
    const store = afterRoundTrip(gateway);
    store.claim('client-1');
    armSchedule(store);
    await store.commit();

    expect(gateway.calls[0]?.bookedFromAppointmentId).toBe('appt-source');
  });

  it('drops the edge when a different account signs in', async () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.repeat(visit('appt-source'), guestLabel);

    const gateway = new StubGateway();
    const store = afterRoundTrip(gateway);
    store.claim('client-2');
    armSchedule(store);
    await store.commit();

    expect(store.bookedFrom()).toBeNull();
    expect(
      gateway.calls[0] && 'bookedFromAppointmentId' in gateway.calls[0],
    ).toBe(false);
  });

  /** Past WHERE, onto the services step, the way a person gets there. */
  function onServices(store: BookingFlowStore): void {
    store.selectLocation(unwrap(LocationId.create('loc-center')));
    store.next();
  }

  it('says whether a draft came back — so a landing knows not to overwrite it', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    // Nothing stored yet: nothing to continue.
    expect(before.restore()).toBe(false);
    onServices(before);
    before.addGuest('Maria');

    TestBed.resetTestingModule();
    const store = createStore(
      new StubGateway(),
      new StubWaitlistGateway(),
      drafts,
    );
    expect(store.restore()).toBe(true);
    expect(store.guests()).toHaveLength(1);
  });

  it('resumes a draft holding two guests under one label on SERVICES, where one rename fixes it', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    onServices(before);
    before.addGuest('Maria');
    before.addGuest('Ani');
    const cut = {
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberPref: BarberPref.any(),
    };
    before.addLine(SeatKey.self(), cut);
    for (const guest of before.guests()) {
      before.addLine(SeatKey.guest(guest.id), cut);
    }
    before.next();
    expect(before.step()).toBe('schedule');

    // A draft from before the rule: both guests answer to «Maria».
    const saved = unwrap(drafts.load()) as BookingDraft;
    drafts.save({
      ...saved,
      party: {
        ...saved.party,
        guests: saved.party.guests.map((guest) => ({
          ...guest,
          label: 'Maria',
        })),
      },
    });

    const { store, came } = restored();
    expect(came).toBe(true);
    // Not the grid: it would seat two people the server counts as one.
    expect(store.step()).toBe('services');
    store.next();
    expect(store.step()).toBe('services');
    expect(store.error()?.code).toBe(
      'scheduling.booking_party.duplicate_label',
    );

    const second = store.guests()[1];
    if (!second) throw new Error('bad fixture');
    expect(store.renameGuest(second.id, 'Ani')).toBe(true);
    store.next();
    expect(store.step()).toBe('schedule');
  });

  it('attaches the visit a signed-out repeat started from, keeping the bag the person built', () => {
    // Signed out at `/book?repeat=`: the visit could not be read, so the
    // person built the bag by hand, then signed in at review.
    const before = createStore(new StubGateway(), undefined, drafts);
    onServices(before);
    before.addLine(SeatKey.self(), {
      serviceId: unwrap(ServiceId.create('svc-beard')),
      variantId: null,
      barberPref: BarberPref.any(),
    });

    const gateway = new StubGateway();
    const store = afterRoundTrip(gateway);
    store.claim('client-1');
    store.attachRepeatSource(visit('appt-source'));

    // Their beard, not the old visit's fade — and the edge rides the commit.
    expect(
      store
        .cart()
        ?.entries()
        .flatMap(([, lines]) => lines.map((line) => line.serviceId.value)),
    ).toEqual(['svc-beard']);
    expect(store.bookedFrom()).toBe('appt-source');
  });

  it('never attaches a rebooking edge to a move', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(visit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim('client-1');
    store.attachRepeatSource(visit('appt-source'));

    expect(store.bookedFrom()).toBeNull();
    expect(store.rescheduleOf()).toBe('appt-moving');
  });

  it('keeps a move a move, rather than committing a second booking', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(visit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim('client-1');

    expect(store.isRescheduling()).toBe(true);
    expect(store.rescheduleOf()).toBe('appt-moving');
  });

  it('brings the riders back with the move — a restored move skips the landing that read them', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    const carried = before.riders();
    expect(carried).toHaveLength(1);

    const store = afterRoundTrip();
    store.claim('client-1');

    expect(store.riders()).toEqual(carried);
  });

  it('brings the visit’s own chairs back with the move, so the restored grid still hands them back', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    const released = before.moveRelease();
    expect(released).toHaveLength(4);

    const store = afterRoundTrip();
    store.claim('client-1');

    expect(store.moveRelease()).toEqual(released);
  });

  /**
   * The draft `partyVisit`'s move writes, with its stored move replaced by
   * `move` — the way a tampered or older tab would have left it.
   */
  function storedMove(move: object): void {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    const saved = unwrap(drafts.load()) as BookingDraft;
    drafts.save({
      ...saved,
      rescheduleOf: {
        appointmentId: 'appt-moving',
        ownerId: 'client-1',
        ...move,
      } as unknown as BookingDraft['rescheduleOf'],
    });
  }

  /** The same tab after the round trip — and whether its draft came back. */
  function restored(): { store: BookingFlowStore; came: boolean } {
    TestBed.resetTestingModule();
    const store = createStore(new StubGateway(), undefined, drafts);
    return { store, came: store.restore() };
  }

  it('never restores a move with a malformed chair — the draft goes, and the link lands the move again', () => {
    const rider = {
      serviceId: 'svc-fade',
      variantId: null,
      barberId: 'petar',
      offsetMinutes: 0,
      durationMinutes: 45,
      setupMinutes: 0,
      cleanupMinutes: 0,
    };
    storedMove({
      riders: [rider],
      chairTimes: [
        // Backwards: no chair ends before it starts.
        { barberId: 'ivan', startMs: 2_000, endMs: 1_000 },
        { barberId: 'petar', startMs: 1_000, endMs: 2_000 },
      ],
    });

    const { store, came } = restored();

    // Half a release is a grid deciding on a visit that does not exist.
    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRelease()).toEqual([]);
    expect(unwrap(drafts.load())).toBeNull();
  });

  it('never restores a move written before its chairs were stored', () => {
    storedMove({ riders: [] });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(unwrap(drafts.load())).toBeNull();
  });

  it('drops the riders with the move when a different account signs in', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim('client-2');

    expect(store.isRescheduling()).toBe(false);
    expect(store.riders()).toEqual([]);
  });

  it('re-binds the party to a DIFFERENT account that signs in — and judges that person’s visit as theirs', () => {
    // A tab whose restored draft account A claimed, now opened by account B
    // on a move link for B's own visit. Judged against A's uid, B's own seat
    // read as a stranger's and the move was refused as the shop's.
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    onServices(before);
    before.addGuest('Maria');

    const store = afterRoundTrip();
    store.claim('client-2');
    expect(store.party()?.ownerId?.value).toBe('client-2');

    const moved = store.rescheduleFrom(
      visit('appt-theirs', 'client-2'),
      guestLabel,
    );
    expect(moved.isSuccess()).toBe(true);
    expect(store.moveRefusal()).toBeNull();
    expect(store.rescheduleOf()).toBe('appt-theirs');
    // Their own seat is the cart's `self`, not a rider carried beside it.
    expect(store.riders()).toEqual([]);
    expect(linesPerPerson(store)).toEqual([1]);
    // …and the draft now names them, so the next round trip keeps the move.
    expect((unwrap(drafts.load()) as BookingDraft).party.ownerId).toBe(
      'client-2',
    );
  });

  it('keeps the party on the same account when that account claims again', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(visit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim('client-1');
    store.claim('client-1');

    expect(store.party()?.ownerId?.value).toBe('client-1');
    expect(store.rescheduleOf()).toBe('appt-moving');
  });

  it('never restores a move with a malformed rider — a dropped rider is a seat the grid stops checking', () => {
    storedMove({
      riders: [
        // Written before riders carried their terms: the grid could not
        // measure this one, and without it the grid would offer times the
        // server refuses for him.
        {
          serviceId: 'svc-beard',
          variantId: null,
          barberId: 'petar',
          offsetMinutes: 0,
        },
        {
          serviceId: 'svc-fade',
          variantId: null,
          barberId: 'petar',
          offsetMinutes: 0,
          durationMinutes: 45,
          setupMinutes: 0,
          cleanupMinutes: 0,
        },
      ],
      chairTimes: [],
    });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(store.riders()).toEqual([]);
    expect(unwrap(drafts.load())).toBeNull();
  });

  it.each([
    ['an empty barber', { barberId: '' }],
    ['an empty service', { serviceId: '' }],
    ['a malformed variant', { variantId: '' }],
  ])(
    'never restores a move whose rider has %s — the grid would drop him from its checks',
    (_what, broken) => {
      storedMove({
        riders: [
          {
            serviceId: 'svc-fade',
            variantId: null,
            barberId: 'petar',
            offsetMinutes: 0,
            durationMinutes: 45,
            setupMinutes: 0,
            cleanupMinutes: 0,
            ...broken,
          },
        ],
        chairTimes: [{ barberId: 'petar', startMs: 1_000, endMs: 2_000 }],
      });

      const { store, came } = restored();

      // Shaped like a rider, but not one the grid can name: restored, he
      // would pass the guard and then vanish from the rider check.
      expect(came).toBe(false);
      expect(store.isRescheduling()).toBe(false);
      expect(store.availabilityRiders()).toEqual([]);
      expect(unwrap(drafts.load())).toBeNull();
    },
  );

  it('never restores a move whose chair names no barber — the release would silently shrink', () => {
    storedMove({
      riders: [],
      chairTimes: [
        { barberId: '', startMs: 1_000, endMs: 2_000 },
        { barberId: 'petar', startMs: 1_000, endMs: 2_000 },
      ],
    });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRelease()).toEqual([]);
    expect(unwrap(drafts.load())).toBeNull();
  });

  it('hands the grid every rider and every chair a restored move holds — none dropped on the way', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const { store, came } = restored();

    expect(came).toBe(true);
    expect(store.availabilityRiders()).toHaveLength(store.riders().length);
    expect(store.moveRelease()).toHaveLength(
      (unwrap(drafts.load()) as BookingDraft).rescheduleOf?.chairTimes.length ??
        -1,
    );
  });

  it('restores a whole move exactly as it was written', () => {
    const before = createStore(new StubGateway(), undefined, drafts);
    before.claim('client-1');
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const { store, came } = restored();

    expect(came).toBe(true);
    expect(store.riders()).toEqual(before.riders());
    expect(store.moveRelease()).toEqual(before.moveRelease());
  });
});

/**
 * `partyVisit` after staff re-seated the son: Niko now, half an hour after
 * his father, and Petar's 10:00 chair free for somebody else.
 */
function reseatedPartyVisit(id: string): Appointment {
  const price = unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = (subject: SeatSubject, barberId: string, start: ZonedDateTime) =>
    Seat.of({
      id: SeatId.generate(),
      subject,
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberId: unwrap(BarberId.create(barberId)),
      terms: unwrap(ServiceTerms.create(price, 45)),
      startsAt: start,
    });
  const halfPastTen = unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour: 10, minute: 30 },
      ZONE,
    ),
  );
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat(
          SeatSubject.account(unwrap(UserId.create('client-1')), 'self'),
          'ivan',
          at(10),
        ),
        seat(
          SeatSubject.account(unwrap(UserId.create('client-son')), 'companion'),
          'niko',
          halfPastTen,
        ),
      ],
      now: at(8),
    }),
  );
}

describe('BookingFlowStore — a move re-reads the visit it is moving', () => {
  let appointments: StubAppointments;
  let store: BookingFlowStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    appointments = new StubAppointments();
    store = createStore(
      new StubGateway(),
      undefined,
      NULL_DRAFT_STORE,
      appointments,
    );
    store.claim('client-1');
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
  });

  function chairs(): string[] {
    return store
      .moveRelease()
      .map((chair) => `${chair.barberId.value}@${chair.occupied.startMs}`);
  }

  it('brings who it carries and the chairs it holds in line with the STORED visit, and keeps the bag', async () => {
    const bag = store.cart();
    appointments.answer = ok(reseatedPartyVisit('appt-moving'));

    await store.rereadMove();

    expect(appointments.reads).toBe(1);
    expect(
      store.riders().map((rider) => [rider.barberId, rider.offsetMinutes]),
    ).toEqual([['niko', 30]]);
    // Petar's old chair is somebody else's now: it is no longer handed back.
    expect(chairs().some((chair) => chair.startsWith('petar@'))).toBe(false);
    expect(chairs().some((chair) => chair.startsWith('niko@'))).toBe(true);
    // What the client built is theirs: only the move's facts were re-read.
    expect(store.cart()).toBe(bag);
    expect(store.moveRefusal()).toBeNull();
  });

  it('keeps what it holds when the read FAILS — the server stays the authority', async () => {
    const before = { riders: store.riders(), release: store.moveRelease() };
    appointments.answer = fail(new RepositoryError('unavailable'));

    await store.rereadMove();

    expect(store.riders()).toBe(before.riders);
    expect(store.moveRelease()).toBe(before.release);
    expect(store.moveRefusal()).toBeNull();
  });

  it('refuses the move, as the landing would, once the visit is gone', async () => {
    appointments.answer = ok(null);

    await store.rereadMove();

    expect(store.moveRefusal()?.reason).toBe('unavailable');
  });

  it('refuses the move as the shop’s once only a companion is left on it', async () => {
    appointments.answer = ok(companionOnlyVisit('appt-moving'));

    await store.rereadMove();

    expect(store.moveRefusal()?.reason).toBe('companions_only');
  });

  it('ignores an answer about a move the flow let go of while the read was out', async () => {
    appointments.answer = ok(reseatedPartyVisit('appt-moving'));

    const reading = store.rereadMove();
    // Somebody else signs in: the move they never read is released.
    store.claim('client-2');
    await reading;

    expect(store.isRescheduling()).toBe(false);
    expect(store.riders()).toEqual([]);
    expect(store.moveRefusal()).toBeNull();
  });

  it('reads nothing when the flow is not a move', async () => {
    TestBed.resetTestingModule();
    const reads = new StubAppointments();
    const plain = createStore(
      new StubGateway(),
      undefined,
      NULL_DRAFT_STORE,
      reads,
    );

    await plain.rereadMove();

    expect(reads.reads).toBe(0);
  });
});

// A waitlist match lands on the SCHEDULE step, past the rename that would
// fix two guests under one name, so its placeholders must already differ.
describe('BookingFlowStore.restoreFromWaitlist — one label, one guest', () => {
  const line = (id: string) => ({
    id,
    serviceId: 'svc-fade',
    variantId: null,
    barberId: null,
  });
  const request = unwrap(
    WaitlistRequest.create({
      id: 'wl-1',
      ownerId: 'client-1',
      locationId: 'loc-center',
      when: { days: [{ dayKey: '2026-08-25', windows: [] }] },
      cart: {
        seats: [
          { seatKey: 'self', lines: [line('line-0')] },
          { seatKey: 'guest-0', lines: [line('line-1')] },
          { seatKey: 'guest-1', lines: [line('line-2')] },
        ],
        nextSequence: 3,
      },
      status: 'open',
      createdAtIso: '2026-08-03T10:00:00.000+03:00',
      zone: ZONE,
    }),
  );

  beforeEach(() => TestBed.resetTestingModule());

  it('names the guests as the catalogue numbers them', () => {
    const store = createStore(new StubGateway());
    expect(store.restoreFromWaitlist(request, null, guestLabel)).toBe(true);
    expect(store.guests().map((guest) => guest.label.value)).toEqual([
      'Guest 1',
      'Guest 2',
    ]);
  });

  it('never hands two guests one placeholder, even from copy that drops the number', () => {
    const store = createStore(new StubGateway());
    expect(store.restoreFromWaitlist(request, null, () => 'Гост')).toBe(true);
    expect(store.step()).toBe('schedule');
    expect(store.party()?.sharedLabel()).toBeNull();
  });
});

describe('firstUnusedLabel — the one placeholder rule', () => {
  const guest = (ordinal: number): string => `Гост ${ordinal}`;

  it('counts up from `from`, stepping past every name in use', () => {
    expect(firstUnusedLabel(new Set(), guest)).toBe('Гост 1');
    expect(firstUnusedLabel(new Set(['Гост 1', 'Гост 2']), guest)).toBe(
      'Гост 3',
    );
    expect(firstUnusedLabel(new Set(['Гост 4']), guest, 4)).toBe('Гост 5');
    // Names that are not placeholders block nothing.
    expect(firstUnusedLabel(new Set(['Мария']), guest, 2)).toBe('Гост 2');
  });

  it('matches the label a guest is stored under — trimmed, as `SeatLabel` keeps it', () => {
    expect(firstUnusedLabel(new Set(['Гост 1']), (n) => ` Гост ${n} `)).toBe(
      'Гост 2',
    );
  });

  it('numbers the word itself when the catalogue ignores the number — never a taken label', () => {
    // A translation missing its `{{number}}` answers the same for every n.
    // The party refuses a label another guest holds, so handing that label
    // back would be an add that silently does nothing.
    expect(firstUnusedLabel(new Set(), () => 'Гост')).toBe('Гост');
    expect(firstUnusedLabel(new Set(['Гост']), () => 'Гост')).toBe('Гост 1');
    expect(firstUnusedLabel(new Set(['Гост', 'Гост 2']), () => 'Гост', 2)).toBe(
      'Гост 3',
    );
  });

  it('never answers a taken label, whatever the catalogue does with the number (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom('Гост', 'Гост 1', 'Гост 2', 'Гост 3'), {
          maxLength: 4,
        }),
        fc.boolean(),
        fc.integer({ min: 1, max: 4 }),
        (takenLabels, ignoresNumber, from) => {
          const taken: ReadonlySet<string> = new Set(takenLabels);
          const label = ignoresNumber ? () => 'Гост' : guest;
          expect(taken.has(firstUnusedLabel(taken, label, from))).toBe(false);
        },
      ),
    );
  });

  it('is the SMALLEST free ordinal from `from`, and never a taken one (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 10 }),
        fc.integer({ min: 1, max: 6 }),
        (takenOrdinals, from) => {
          const taken = new Set(takenOrdinals.map(guest));
          const label = firstUnusedLabel(taken, guest, from);
          expect(taken.has(label)).toBe(false);
          const ordinal = Number(label.replace('Гост ', ''));
          expect(ordinal).toBeGreaterThanOrEqual(from);
          for (let earlier = from; earlier < ordinal; earlier++) {
            expect(taken.has(guest(earlier))).toBe(true);
          }
        },
      ),
    );
  });
});
