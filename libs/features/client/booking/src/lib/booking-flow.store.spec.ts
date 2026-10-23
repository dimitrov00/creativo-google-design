import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  BOOKING_DRAFT_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  type AppointmentReadPorts,
  type BookingDraftPorts,
  Callables,
  type GatewayPorts,
  type IdPorts,
} from '@core/ports';
import type { Appointment, WaitlistRequest } from '@core/entities';
import {
  BookingCall,
  BookingDraft,
  BookingFlowStep,
  DayWindows,
  FlexibleWhen,
  MoveRefusalReason,
  Party,
  PartyRole,
  Placement,
  RequestedSubjectRole,
  ScheduleSelection,
  Seat,
  SeatKey,
  SeatLabel,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
  WaitlistLifecycle,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  CartLineId,
  CustomerId,
  LocationId,
  Result,
  SeatId,
  SeatKeyText,
  ServiceId,
  UserId,
  WaitlistRequestId,
} from '@core/primitives';
import {
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  type GatewayCall,
  appointmentFixture,
  at as minuteAt,
  endMinute,
  localDate,
  memoryAppointmentReadPorts,
  minute,
  scriptedGatewayPorts,
  seatFixture,
  termsFixture,
  unwrapOk,
  until,
  utcMs,
} from '@core/testing';
import { BookingFlowStore } from './booking-flow.store';

/** The shop day every walk books on — the pinned day of the visits below. */
const DAY = localDate('2026-08-03');
const CENTER = LocationId.of('loc-center');
const IVAN = BarberId.of('ivan');
const SELF = SeatKey.text(SeatKey.self());

/** A guest's cart seat key. */
function guestSeat(guestId: string): SeatKeyText {
  return SeatKeyText.of(guestId);
}

/** A line for the bag: the service, anyone, any shop. */
function line(serviceId: string) {
  return {
    serviceId: ServiceId.of(serviceId),
    variantId: null,
    barberId: null,
    locationId: null,
  };
}

/**
 * The server, as these specs script it: what each callable answers next,
 * and every call it was dialled with (`scriptedGatewayPorts`).
 */
interface Server {
  readonly gateway: GatewayPorts;
  readonly calls: GatewayCall[];
  commitAnswer: Result<BookingCall.Committed, PipelineError>;
  /** A move's answer, by its 1-based call count. */
  moveAnswer: (call: number) => Result<BookingCall.Rescheduled, PipelineError>;
  commits(): readonly BookingCall[];
  moves(): readonly BookingCall.Reschedule[];
}

function server(): Server {
  const calls: GatewayCall[] = [];
  let moveCount = 0;
  const answers: {
    commit: Result<BookingCall.Committed, PipelineError>;
    move: (call: number) => Result<BookingCall.Rescheduled, PipelineError>;
  } = {
    commit: Result.ok({ appointmentId: AppointmentId.of('appt-1') }),
    move: () => Result.ok({ appointmentId: AppointmentId.of('appt-moving') }),
  };
  return {
    gateway: scriptedGatewayPorts(
      {
        [Callables.CommitBooking]: () => answers.commit,
        [Callables.RescheduleAppointment]: () => answers.move(++moveCount),
        [Callables.RequestWaitlist]: () =>
          Result.ok({ requestId: WaitlistRequestId.of('wl-1') }),
      },
      calls,
    ),
    calls,
    get commitAnswer() {
      return answers.commit;
    },
    set commitAnswer(answer) {
      answers.commit = answer;
    },
    get moveAnswer() {
      return answers.move;
    },
    set moveAnswer(answer) {
      answers.move = answer;
    },
    commits: () =>
      calls
        .filter((call) => call.callable === Callables.CommitBooking)
        .map((call) => call.input as BookingCall),
    moves: () =>
      calls
        .filter((call) => call.callable === Callables.RescheduleAppointment)
        .map((call) => call.input as BookingCall.Reschedule),
  };
}

/** `sessionStorage` is not worth doubling here — the flow is what's under test. */
function nullDrafts(): BookingDraftPorts {
  return {
    loadBookingDraft: () => Result.ok(null),
    saveBookingDraft: () => Result.ok(undefined),
    clearBookingDraft: () => Result.ok(undefined),
  };
}

/**
 * A `sessionStorage` stand-in that keeps one draft, JSON round trip and all
 * — read back through `BookingDraft.read`, the rule the adapter reads by,
 * and cleared when that read refuses it.
 */
interface Drafts extends BookingDraftPorts {
  /** The stored JSON, parsed — what a tab would find. */
  raw(): Record<string, unknown> | null;
  /** Store a hand-made value, the way a tampered or older tab left it. */
  write(raw: object): void;
}

function jsonDrafts(): Drafts {
  let stored: string | null = null;
  return {
    loadBookingDraft: () => {
      if (stored === null) return Result.ok(null);
      const draft = BookingDraft.read(JSON.parse(stored));
      if (draft === null) {
        stored = null;
        return Result.err(RepositoryError.malformed('booking-draft', null));
      }
      return Result.ok(draft);
    },
    saveBookingDraft: (draft) => {
      stored = JSON.stringify(draft);
      return Result.ok(undefined);
    },
    clearBookingDraft: () => {
      stored = null;
      return Result.ok(undefined);
    },
    raw: () =>
      stored === null ? null : (JSON.parse(stored) as Record<string, unknown>),
    write: (raw) => {
      stored = JSON.stringify(raw);
    },
  };
}

/** The owner-scoped visit read: answers as told, and counts the reads. */
interface Visits {
  answer: Result<Appointment | null, RepositoryError>;
  reads: number;
  ports(): AppointmentReadPorts;
}

function visits(): Visits {
  const double: Visits = {
    answer: Result.ok(null),
    reads: 0,
    ports: () => ({
      ...memoryAppointmentReadPorts([]),
      observeAppointment: () => {
        double.reads += 1;
        return of(double.answer);
      },
    }),
  };
  return double;
}

/**
 * Client operation ids the server's charset takes (`[A-Za-z0-9_-]{16,64}`),
 * one per mint, in order.
 */
function attemptIds(): IdPorts {
  let minted = 0;
  return {
    nextId: () => `attempt-${String(++minted).padStart(16, '0')}`,
  };
}

function createStore(
  gateway: Server,
  drafts: BookingDraftPorts = nullDrafts(),
  appointments: Visits = visits(),
  ids: IdPorts = attemptIds(),
): BookingFlowStore {
  TestBed.configureTestingModule({
    providers: [
      { provide: BOOKING_DRAFT_PORTS, useValue: drafts },
      { provide: GATEWAY_PORTS, useValue: gateway.gateway },
      { provide: ID_PORTS, useValue: ids },
      { provide: APPOINTMENT_READ_PORTS, useValue: appointments.ports() },
      BookingFlowStore,
    ],
  });
  return TestBed.inject(BookingFlowStore);
}

/** Every line the bag holds, booker first, as the cart keeps them. */
function cartLines(store: BookingFlowStore) {
  return (store.cart()?.cartSeats ?? []).flatMap((seat) => seat.lines);
}

/**
 * Every line, served by Ivan from `start` to `start + 60` on {@link DAY} at
 * the Center — the arrangement a sheet hands the machine.
 */
function selectionFor(store: BookingFlowStore, start = 12 * 60) {
  const selection = ScheduleSelection.of(
    CENTER,
    DAY,
    cartLines(store).map((entry) => {
      const lineId = store.cartLineId(entry.lineId);
      if (!lineId) throw new Error('fixture setup failed: line went missing');
      return {
        lineId,
        barberId: IVAN,
        startMinutes: minute(start),
        endMinutes: endMinute(start + 60),
      };
    }),
  );
  if (selection === null) throw new Error('fixture setup failed: no lines');
  return selection;
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
  store.selectLocation(CENTER);
  store.next();

  store.addGuest('Maria');

  store.addLine(SELF, line('svc-fade'));
  const guest = store.guests()[0];
  if (!guest) throw new Error('fixture setup failed: no guest');
  store.addLine(guestSeat(guest.guestId), line('svc-beard'));
  store.next();

  store.selectDay(DAY);
  store.selectStart(minute(12 * 60), CENTER);

  // Both seats, served in parallel — the envelope is the longer of the two,
  // which for one hour each is the hour.
  const selection = selectionFor(store);
  store.selectSchedule(selection);
  return selection;
}

describe('BookingFlowStore — commit', () => {
  let gateway: Server;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = server();
    store = createStore(gateway);
  });

  it('sends WHAT and WHO on the shop’s wall clock, and never a price or a duration', async () => {
    walkToReview(store);
    await store.commit();

    const [request] = gateway.commits();
    // One per seat — the guest travels too, as a LABEL, because that is all a
    // party member is until they have an account of their own.
    expect(request?.seats).toHaveLength(2);
    // The guest's seat key rides beside the label, so the server can tell
    // two DIFFERENT guests under one name from one guest with two services.
    expect(request?.seats.map((seat) => seat.subject)).toEqual([
      { requestedSubjectRole: RequestedSubjectRole.Self },
      {
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Maria',
        guestKey: 'guest-0',
      },
    ]);
    // The placement is the shop day and its minutes — the pipeline places
    // them on the absolute timeline once, with the location's zone.
    expect(request?.localDate).toBe('2026-08-03');
    expect(request?.locationId).toBe('loc-center');
    // Read as a loose bag on purpose: the assertion is that these keys do
    // not EXIST on the wire, which the typed shape cannot express.
    const seat = request?.seats[0] as unknown as Record<string, unknown>;
    // The server resolves terms. A client that could name its own price
    // would book a 40 € fade for nothing.
    expect(seat['priceCents']).toBeUndefined();
    expect(seat['durationMinutes']).toBeUndefined();
    expect(seat['barberId']).toBe('ivan');
    expect(seat['startMinutes']).toBe(12 * 60);
    expect(seat['subject']).toEqual({
      requestedSubjectRole: RequestedSubjectRole.Self,
    });
  });

  it('lands on `CONFIRMED` with the server’s appointment id', async () => {
    walkToReview(store);
    await store.commit();

    expect(store.step()).toBe(BookingFlowStep.Confirmed);
    expect(store.confirmation()?.appointmentId).toBe('appt-1');
  });

  it('bounces BACK to the schedule when the slot was taken — keeping the day', async () => {
    // The one recoverable failure. The user should land on a fresh grid on
    // the day they already chose, not at the start of the wizard.
    walkToReview(store);
    gateway.commitAnswer = Result.err(
      PipelineError.bare(PipelineErrorCode.SlotUnavailable),
    );

    await store.commit();

    expect(store.step()).toBe(BookingFlowStep.Schedule);
    expect(store.slotTaken()).toBe(true);
    expect(store.selectedLocalDate()).toBe('2026-08-03');
    // …but NOT the time it can no longer honour.
    expect(store.selectedStartMinutes()).toBeNull();
    expect(store.selectedLocationId()).toBeNull();
    // The bag and the party survive — nothing about a lost race invalidates them.
    expect(store.lineCount()).toBe(2);
    expect(store.guests()).toHaveLength(1);
  });

  it('STAYS on review for a failure re-picking a time cannot fix', async () => {
    walkToReview(store);
    gateway.commitAnswer = Result.err(
      PipelineError.bare(PipelineErrorCode.CatalogChanged),
    );

    await store.commit();

    expect(store.step()).toBe(BookingFlowStep.Review);
    expect(store.slotTaken()).toBe(false);
    expect(store.error()).not.toBeNull();
  });

  it('refuses to double-submit while a commit is in flight', async () => {
    walkToReview(store);
    const first = store.commit();
    const second = store.commit();
    await Promise.all([first, second]);

    expect(gateway.commits()).toHaveLength(1);
  });

  it('does nothing at all outside the review step', async () => {
    await store.commit();

    expect(gateway.calls).toHaveLength(0);
    expect(store.step()).toBe(BookingFlowStep.Location);
  });

  it('REFUSES the same service twice for one person', () => {
    // You cannot have two haircuts in one visit; the party is what makes a
    // second haircut expressible, and it belongs to a different seat.
    store.selectLocation(null);
    store.next();
    store.addGuest('Maria');
    store.next();

    store.addLine(SELF, line('svc-fade'));
    store.addLine(SELF, line('svc-fade'));
    expect(store.lineCount()).toBe(1);

    // …but the SAME service for the guest is the ordinary case.
    const guest = store.guests()[0];
    if (!guest) throw new Error('fixture setup failed: no guest');
    store.addLine(guestSeat(guest.guestId), line('svc-fade'));
    expect(store.lineCount()).toBe(2);
  });

  it('treats "any shop" as an answer — the first step never blocks', () => {
    // `null` is a choice, not an absence, so `next` has no precondition to fail.
    store.selectLocation(null);
    store.next();

    expect(store.step()).toBe(BookingFlowStep.Services);
    expect(store.locationId()).toBeNull();
  });
});

/** An account seat's occupant — the uid and the client record beside it (D29). */
function account(uid: string, relationship: SubjectRelationship): SeatOccupant {
  return SeatOccupant.account(
    UserId.of(uid),
    CustomerId.of(`cus_${uid}`),
    relationship,
  );
}

const self = (uid: string) => account(uid, SubjectRelationship.Self);
const companion = (uid: string) => account(uid, SubjectRelationship.Companion);
const guest = (label: string) => SeatOccupant.anonymous(SeatLabel.of(label));

/** One stored seat: who, with whom, on what, when (minutes from the shop's midnight) and on what terms. */
interface StoredSeat {
  readonly occupant: SeatOccupant;
  readonly barberId: string;
  readonly serviceId?: string;
  readonly startMinutes: number;
  readonly priceCents?: number;
  readonly durationMinutes?: number;
  readonly setupMinutes?: number;
  readonly cleanupMinutes?: number;
}

/**
 * A visit at the Center on 2026-08-03, as stored: the seats, and the
 * envelope and its instant derived from them — the shop's zone placing it
 * once. Every seat sold at 28,00 € for 45 minutes unless it says otherwise.
 */
function storedVisit(id: string, seats: readonly StoredSeat[]): Appointment {
  const stored = seats.map((seat, index) => {
    const terms = termsFixture(
      seat.priceCents ?? 2800,
      seat.durationMinutes ?? 45,
      seat.setupMinutes ?? 0,
      seat.cleanupMinutes ?? 0,
    );
    return seatFixture({
      seatId: SeatId.of(`${id}-seat-${index + 1}`),
      serviceId: ServiceId.of(seat.serviceId ?? 'svc-fade'),
      barberId: BarberId.of(seat.barberId),
      startMinutes: minuteAt(0, seat.startMinutes),
      terms: Seat.termsOf(terms, terms),
      occupant: seat.occupant,
    });
  });
  const start = minuteAt(
    0,
    Math.min(...stored.map((seat) => seat.startMinutes)),
  );
  const barberIds = [...new Set(stored.map((seat) => seat.barberId))];
  return appointmentFixture({
    id: AppointmentId.of(id),
    locationId: CENTER,
    ownerUserId: UserId.of('client-1'),
    subjectUserIds: [
      ...new Set(
        stored.flatMap((seat) =>
          seat.seatSubject === SeatSubject.Account ? [seat.subjectUserId] : [],
        ),
      ),
    ],
    barberIds,
    busyKeys: barberIds.map((barberId) => BusyKey.of(barberId, DAY)),
    seats: stored,
    localDate: DAY,
    startMinutes: start,
    endMinutes: until(
      0,
      Math.max(...stored.map((seat) => Seat.endMinutes(seat))),
    ),
    utcEpochMs: unwrapOk(ZonedTimeSystem.toUtc(DAY, start, FIXTURE_TIME_ZONE)),
  });
}

/** A visit to book again: the booker's fade with Ivan at the Center. */
function visit(id: string, booker = 'client-1'): Appointment {
  return storedVisit(id, [
    { occupant: self(booker), barberId: 'ivan', startMinutes: 10 * 60 },
  ]);
}

const guestLabel = (ordinal: number): string => `Guest ${ordinal}`;

/** From the schedule step a repeat lands on, to review: Ivan at 12:00. */
function armSchedule(store: BookingFlowStore): void {
  store.selectDay(DAY);
  store.selectStart(minute(12 * 60), CENTER);
  store.selectSchedule(selectionFor(store));
}

// Defect §2.3 #6: `/book?repeat=` rebuilt the bag and then dropped the visit
// it came from, so every rebooking landed with `bookedFrom: null` — a fact
// no backfill can recover.
describe('BookingFlowStore — the rebooking edge', () => {
  let gateway: Server;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = server();
    store = createStore(gateway);
  });

  it('sends the visit a repeat started from as `bookedFromAppointmentId`', async () => {
    expect(store.repeat(visit('appt-source'), guestLabel)).toBe(true);
    expect(store.step()).toBe(BookingFlowStep.Schedule);

    armSchedule(store);
    await store.commit();

    expect(gateway.commits()).toHaveLength(1);
    expect(gateway.commits()[0]?.bookedFromAppointmentId).toBe('appt-source');
  });

  it('sends `null` for the edge on a cold booking — present on the wire, never guessed', async () => {
    walkToReview(store);
    await store.commit();

    const [request] = gateway.commits();
    if (!request) throw new Error('nothing was committed');
    // The flipped wire carries every key (4A-4): a cold booking says it
    // knows nothing about where it came from with `null`.
    expect(request.bookedFromAppointmentId).toBeNull();
    expect(request.onBehalfOfUserId).toBeNull();
    // `/book` is the client placing their own booking — whoever is signed in.
    expect(request.placement).toBe(Placement.Self);
    expect(store.bookedFrom()).toBeNull();
  });

  it('keeps the edge through an edited bag and a lost race', async () => {
    store.repeat(visit('appt-source'), guestLabel);
    // A beard added on the services step is still a booking made from that
    // visit.
    store.back();
    store.addLine(SELF, line('svc-beard'));
    store.next();
    expect(store.lineCount()).toBe(2);

    armSchedule(store);
    gateway.commitAnswer = Result.err(
      PipelineError.bare(PipelineErrorCode.SlotUnavailable),
    );
    await store.commit();
    expect(store.step()).toBe(BookingFlowStep.Schedule);

    gateway.commitAnswer = Result.ok({
      appointmentId: AppointmentId.of('appt-2'),
    });
    armSchedule(store);
    await store.commit();

    expect(
      gateway.commits().map((request) => request.bookedFromAppointmentId),
    ).toEqual(['appt-source', 'appt-source']);
  });

  it('never marks a move as a rebooking', () => {
    // A reschedule keeps its own appointment; it is not a booking made from
    // one, and its request has no such field to carry.
    store.repeat(visit('appt-earlier'), guestLabel);
    expect(store.rescheduleFrom(visit('appt-moving'), guestLabel).ok).toBe(
      true,
    );

    expect(store.isRescheduling()).toBe(true);
    expect(store.bookedFrom()).toBeNull();
  });
});

/**
 * A father, his son (an ACCOUNT staff seated beside him) and a guest with two
 * services — the party a prefill has to keep straight.
 */
function partyVisit(id: string): Appointment {
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    {
      occupant: companion('client-son'),
      barberId: 'petar',
      startMinutes: 10 * 60,
    },
    { occupant: guest('Мария'), barberId: 'stefan', startMinutes: 10 * 60 },
    {
      occupant: guest('Мария'),
      barberId: 'stefan',
      serviceId: 'svc-beard',
      startMinutes: 11 * 60,
    },
  ]);
}

/**
 * A visit left holding only the son — staff removed the father's own seat
 * when he could not come. Nobody on it is the cart's to name.
 */
function companionOnlyVisit(id: string): Appointment {
  return storedVisit(id, [
    {
      occupant: companion('client-son'),
      barberId: 'petar',
      serviceId: 'svc-beard',
      startMinutes: 10 * 60,
      priceCents: 2000,
      durationMinutes: 30,
    },
  ]);
}

/** The father at 10:00 with Ivan, and his son straight after, same chair. */
function sequentialVisit(id: string): Appointment {
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    {
      occupant: companion('client-son'),
      barberId: 'ivan',
      serviceId: 'svc-beard',
      startMinutes: 10 * 60 + 45,
    },
  ]);
}

/**
 * The booker at 10:00 with Ivan, and a companion the shop seated with Petar
 * fifteen minutes EARLIER, on hand-set terms with setup and cleanup.
 */
function padsVisit(id: string): Appointment {
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    {
      occupant: companion('client-son'),
      barberId: 'petar',
      serviceId: 'svc-beard',
      startMinutes: 10 * 60 - 15,
      durationMinutes: 30,
      setupMinutes: 5,
      cleanupMinutes: 10,
    },
  ]);
}

/**
 * The booker at 10:00, and a seat that says `self` for ANOTHER account right
 * after — a stored shape the client's cart cannot speak for.
 */
function foreignSelfVisit(id: string): Appointment {
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    {
      occupant: self('client-other'),
      barberId: 'petar',
      startMinutes: 11 * 60,
    },
  ]);
}

/**
 * The booker, plus two anonymous seats under ONE label — side by side with
 * two barbers, or back to back with one — and a third guest under another.
 */
function sharedLabelVisit(
  id: string,
  arrangement: 'side_by_side' | 'back_to_back',
): Appointment {
  const second: StoredSeat =
    arrangement === 'side_by_side'
      ? {
          occupant: guest('Walk-in'),
          barberId: 'petar',
          serviceId: 'svc-beard',
          startMinutes: 12 * 60,
        }
      : {
          occupant: guest('Walk-in'),
          barberId: 'stefan',
          serviceId: 'svc-beard',
          startMinutes: 13 * 60,
        };
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    { occupant: guest('Walk-in'), barberId: 'stefan', startMinutes: 12 * 60 },
    second,
    { occupant: guest('Мария'), barberId: 'ivan', startMinutes: 11 * 60 },
  ]);
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
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    ...(options.withCompanion
      ? [
          {
            occupant: companion('client-son'),
            barberId: 'petar',
            startMinutes: 10 * 60,
          },
        ]
      : []),
    { occupant: guest(label), barberId: 'stefan', startMinutes: 10 * 60 },
  ]);
}

function linesPerPerson(store: BookingFlowStore): number[] {
  return (store.cart()?.cartSeats ?? []).map((seat) => seat.lines.length);
}

function guestLabels(store: BookingFlowStore): string[] {
  return store.guests().map((member) => member.guestLabel);
}

const CLIENT = UserId.of('client-1');

describe('BookingFlowStore — who a prefilled bag holds', () => {
  let gateway: Server;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = server();
    store = createStore(gateway);
  });

  it('leaves a companion ACCOUNT out of a move — the server carries them, so no phantom guest', () => {
    expect(store.rescheduleFrom(partyVisit('appt-moving'), guestLabel).ok).toBe(
      true,
    );

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

    // Under the name the visit stored for her, not a placeholder.
    expect(guestLabels(store)).toEqual(['Мария']);
    expect(store.lineCount()).toBe(3);
  });

  it('keeps the name the SHOP gave a guest through a move, and sends it — never «Guest 1» over it', async () => {
    store.claim(CLIENT);
    store.rescheduleFrom(
      labelledGuestVisit('appt-moving', 'Иван (син)'),
      guestLabel,
    );
    expect(guestLabels(store)).toEqual(['Иван (син)']);

    armSchedule(store);
    await store.commit();
    // The label the server matches its stored seat by (`personKey`, the
    // replay check) — the one it already holds.
    expect(
      (gateway.moves()[0]?.seats ?? []).flatMap((seat) =>
        seat.subject.requestedSubjectRole === RequestedSubjectRole.Guest
          ? [seat.subject.label]
          : [],
      ),
    ).toEqual(['Иван (син)']);
  });

  it('keeps the stored names on a repeat too, and numbers a nameless companion around them', () => {
    // A companion ACCOUNT has no label, so on a repeat he needs a
    // placeholder — and «Guest 1» is already somebody's stored name.
    store.repeat(
      labelledGuestVisit('appt-source', 'Guest 1', { withCompanion: true }),
      guestLabel,
    );

    expect(guestLabels(store)).toEqual(['Guest 2', 'Guest 1']);
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
    store.claim(CLIENT);
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    armSchedule(store);
    await store.commit();

    expect(gateway.commits()).toHaveLength(0);
    expect(gateway.moves()).toHaveLength(1);
    const [move] = gateway.moves();
    expect(move?.appointmentId).toBe('appt-moving');
    // The move's placement is the shop day too.
    expect(move?.localDate).toBe('2026-08-03');
    expect(
      move?.seats.map((seat) => seat.subject.requestedSubjectRole).sort(),
    ).toEqual([
      RequestedSubjectRole.Guest,
      RequestedSubjectRole.Guest,
      RequestedSubjectRole.Self,
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
      store.claim(CLIENT);
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
    store.claim(CLIENT);
    store.rescheduleFrom(
      sharedLabelVisit('appt-moving', 'side_by_side'),
      guestLabel,
    );
    armSchedule(store);
    await store.commit();

    const labels = (gateway.moves()[0]?.seats ?? [])
      .flatMap((seat) =>
        seat.subject.requestedSubjectRole === RequestedSubjectRole.Guest
          ? [seat.subject.label]
          : [],
      )
      .sort();
    // The walk-in holds both of their lines, under the one stored name.
    expect(labels).toEqual(['Walk-in', 'Walk-in', 'Мария']);
  });

  it('keeps guests under DIFFERENT labels different people', () => {
    store.repeat(sharedLabelVisit('appt-source', 'back_to_back'), guestLabel);

    // The walk-in and Мария: two people, never merged by position or time.
    expect(guestLabels(store)).toEqual(['Walk-in', 'Мария']);
  });
});

describe('BookingFlowStore — one label, one guest', () => {
  it('answers whether a rename was taken, and holds WHY it was not', () => {
    const store = createStore(server());
    store.selectLocation(null);
    store.next();
    store.addGuest('Maria');
    store.addGuest('Guest 2');
    const [maria, second] = store.guests();
    if (!maria || !second) throw new Error('fixture setup failed');

    expect(store.renameGuest(second.guestId, 'Maria')).toBe(false);
    expect(store.error()?.errorCode).toBe(
      'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
    );
    expect(guestLabels(store)).toEqual(['Maria', 'Guest 2']);

    expect(store.renameGuest(second.guestId, 'Ivan')).toBe(true);
    expect(store.error()).toBeNull();
    expect(guestLabels(store)).toEqual(['Maria', 'Ivan']);
  });
});

/*
 * A MOVE NAMES ITS ATTEMPT (round 3). The server keys a move's audit rows by
 * the attempt id, so a retry whose first attempt landed fills a lost row
 * instead of logging nothing — which only works if the client sends it.
 */
describe('BookingFlowStore — a move names its attempt, like a commit', () => {
  let gateway: Server;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = server();
    gateway.moveAnswer = (call) =>
      call === 1
        ? Result.err(PipelineError.bare(PipelineErrorCode.Unavailable))
        : Result.ok({ appointmentId: AppointmentId.of('appt-moving') });
    store = createStore(gateway);
    store.claim(CLIENT);
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
  });

  it('sends the armed selection’s attempt id with the move, and the SAME one on a retry', async () => {
    armSchedule(store);
    await store.commit(); // lost to the network — stays on review
    expect(store.step()).toBe(BookingFlowStep.Review);
    await store.commit(); // the retry of the same selection

    const [first, retry] = gateway.moves();
    expect(gateway.moves()).toHaveLength(2);
    expect(first?.attemptId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(retry?.attemptId).toBe(first?.attemptId);
    expect(gateway.commits()).toHaveLength(0);
  });

  it('mints a NEW attempt id for a new selection — a new pick is a new attempt', async () => {
    armSchedule(store);
    await store.commit();
    store.back();
    armSchedule(store);
    await store.commit();

    const [first, second] = gateway.moves();
    expect(second?.attemptId).toBeDefined();
    expect(second?.attemptId).not.toBe(first?.attemptId);
  });
});

/*
 * THE ATTEMPT ID COMES FROM THE ID SOURCE (`ID_PORTS`, 4A-12), parsed as a
 * `ClientOperationId`. An id the server's charset refuses never reaches the
 * wire: a move travels without one (it names its audit rows only), and a
 * new booking — whose attempt id IS the appointment's idempotency key — is
 * refused before anything is sent.
 */
describe('BookingFlowStore — the attempt id is the id source’s', () => {
  const unnamed: IdPorts = { nextId: () => 'short' };

  it('sends the id source’s own id with a commit', async () => {
    const gateway = server();
    const store = createStore(gateway);
    walkToReview(store);
    await store.commit();

    // Minted once at construction, then once per armed selection.
    expect(gateway.commits()[0]?.attemptId).toBe('attempt-0000000000000002');
  });

  it('refuses a commit whose attempt the source could not name — nothing is sent', async () => {
    const gateway = server();
    const store = createStore(gateway, nullDrafts(), visits(), unnamed);
    walkToReview(store);
    await store.commit();

    expect(gateway.calls).toHaveLength(0);
    expect(store.step()).toBe(BookingFlowStep.Review);
    expect(store.error()?.errorCode).toBe(PipelineErrorCode.InvalidRequest);
  });

  it('sends a move without an attempt id it could not name', async () => {
    const gateway = server();
    const store = createStore(gateway, nullDrafts(), visits(), unnamed);
    store.claim(CLIENT);
    store.rescheduleFrom(visit('appt-moving'), guestLabel);
    armSchedule(store);
    await store.commit();

    expect(gateway.moves()).toHaveLength(1);
    expect(gateway.moves()[0]?.attemptId).toBeNull();
  });
});

/**
 * A `?reschedule=` link binds the flow to THAT move. Every way it cannot
 * become one is said, and none of them may end as a second booking.
 */
describe('BookingFlowStore — a move the cart cannot make', () => {
  let gateway: Server;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = server();
    store = createStore(gateway);
  });

  it('refuses a visit that holds nobody but a companion — no bag, no move, and says why', () => {
    const result = store.rescheduleFrom(
      companionOnlyVisit('appt-son'),
      guestLabel,
    );

    expect(!result.ok && result.error).toBe(MoveRefusalReason.CompanionsOnly);
    expect(store.moveRefusal()?.moveRefusalReason).toBe(
      MoveRefusalReason.CompanionsOnly,
    );
    // The shop it is at — what the refusal's call button dials.
    expect(store.moveRefusal()?.locationId).toBe('loc-center');
    expect(store.isRescheduling()).toBe(false);
    // Nothing was prefilled: the son is not turned into a guest to move.
    expect(store.lineCount()).toBe(0);
    expect(store.step()).toBe(BookingFlowStep.Location);
  });

  it('never commits a move link as a new booking — not while the visit loads, not once it is refused', async () => {
    store.expectMove('appt-son');
    walkToReview(store);

    // Still loading: there is no move to send yet, and no new booking either.
    await store.commit();
    expect(gateway.calls).toHaveLength(0);
    expect(store.error()).not.toBeNull();

    // Refused: the same, for good.
    store.rescheduleFrom(companionOnlyVisit('appt-son'), guestLabel);
    await store.commit();
    expect(gateway.calls).toHaveLength(0);
  });

  it('commits the move once the visit it was opened for has landed', async () => {
    store.claim(CLIENT);
    store.expectMove('appt-moving');
    expect(store.rescheduleFrom(visit('appt-moving'), guestLabel).ok).toBe(
      true,
    );
    armSchedule(store);
    await store.commit();

    expect(gateway.commits()).toHaveLength(0);
    expect(gateway.moves()).toHaveLength(1);
    expect(store.moveRefusal()).toBeNull();
  });

  it('keeps who the server carries, at their distance from the booker — side by side, or straight after', () => {
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    expect(store.moveRiders()).toEqual([
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
    expect(store.moveRiders()).toEqual([
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
    expect(pinned?.barberId).toBe('petar');
    // …and WHAT he is served: a shop that does not offer his beard has no
    // time for this move, and the day query can only tell by the service.
    expect(pinned?.serviceId).toBe('svc-beard');
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
    store.claim(CLIENT);
    expect(
      store.rescheduleFrom(foreignSelfVisit('appt-moving'), guestLabel).ok,
    ).toBe(true);

    // The booker alone in the bag; the foreign `self` rides along.
    expect(store.guests()).toHaveLength(0);
    expect(linesPerPerson(store)).toEqual([1]);
    expect(store.moveRiders().map((rider) => rider.barberId)).toEqual([
      'petar',
    ]);
  });

  it('offers a foreign `self` seat as a GUEST on a repeat — never as the booker a second time', () => {
    store.claim(CLIENT);
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
    expect(store.moveLocalDate()).toBeNull();

    store.rescheduleFrom(padsVisit('appt-moving'), guestLabel);
    // On the visit's own shop day, its wall clock.
    expect(store.moveLocalDate()).toBe('2026-08-03');
    expect(store.moveRelease()).toEqual([
      // The booker's fade with Ivan, the seat the cart rebuilds…
      { barberId: 'ivan', startMinutes: 10 * 60, endMinutes: 10 * 60 + 45 },
      // …and the son's beard the move carries, setup and cleanup included:
      // the server subtracts the whole visit before it re-places it.
      {
        barberId: 'petar',
        startMinutes: 9 * 60 + 40,
        endMinutes: 10 * 60 + 25,
      },
    ]);
  });

  it('has no riders on a new booking, or on a move with nobody to carry', () => {
    store.repeat(partyVisit('appt-source'), guestLabel);
    expect(store.moveRiders()).toEqual([]);

    store.rescheduleFrom(visit('appt-moving'), guestLabel);
    expect(store.moveRiders()).toEqual([]);
  });
});

// The review step's sign-in round trip returns to `/book?step=schedule` —
// without the `?repeat=` that set the edge — and a new store restores the
// draft. The edge must come back with it, for the account that read the
// visit and for nobody else.
describe('BookingFlowStore — the sources survive the sign-in round trip', () => {
  let drafts: Drafts;

  beforeEach(() => {
    drafts = jsonDrafts();
  });

  /** The same tab after the round trip: a fresh store over the same draft. */
  function afterRoundTrip(gateway = server()): BookingFlowStore {
    TestBed.resetTestingModule();
    const store = createStore(gateway, drafts);
    store.restore();
    return store;
  }

  /** The same tab after the round trip — and whether its draft came back. */
  function restored(): { store: BookingFlowStore; came: boolean } {
    TestBed.resetTestingModule();
    const store = createStore(server(), drafts);
    return { store, came: store.restore() };
  }

  it('commits the restored rebooking edge for the same account', async () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.repeat(visit('appt-source'), guestLabel);
    armSchedule(before);
    // The draft is FLAT: the edge rides at its root, on its origin.
    expect(drafts.raw()?.['bookingDraftOrigin']).toBe('BOOKED_FROM');
    expect(drafts.raw()?.['bookedFromAppointmentId']).toBe('appt-source');

    const gateway = server();
    const store = afterRoundTrip(gateway);
    store.claim(CLIENT);
    armSchedule(store);
    await store.commit();

    expect(gateway.commits()[0]?.bookedFromAppointmentId).toBe('appt-source');
  });

  it('drops the edge when a different account signs in', async () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.repeat(visit('appt-source'), guestLabel);

    const gateway = server();
    const store = afterRoundTrip(gateway);
    store.claim(UserId.of('client-2'));
    armSchedule(store);
    await store.commit();

    expect(store.bookedFrom()).toBeNull();
    expect(gateway.commits()[0]?.bookedFromAppointmentId).toBeNull();
  });

  /** Past WHERE, onto the services step, the way a person gets there. */
  function onServices(store: BookingFlowStore): void {
    store.selectLocation(CENTER);
    store.next();
  }

  it('says whether a draft came back — so a landing knows not to overwrite it', () => {
    const before = createStore(server(), drafts);
    // Nothing stored yet: nothing to continue.
    expect(before.restore()).toBe(false);
    onServices(before);
    before.addGuest('Maria');

    const { store, came } = restored();
    expect(came).toBe(true);
    expect(store.guests()).toHaveLength(1);
  });

  it('resumes a draft holding two guests under one label on SERVICES, where one rename fixes it', () => {
    const before = createStore(server(), drafts);
    onServices(before);
    before.addGuest('Maria');
    before.addGuest('Ani');
    before.addLine(SELF, line('svc-fade'));
    for (const member of before.guests()) {
      before.addLine(guestSeat(member.guestId), line('svc-fade'));
    }
    before.next();
    expect(before.step()).toBe(BookingFlowStep.Schedule);

    // A draft from before the rule: both guests answer to «Maria».
    const saved = drafts.raw() as {
      readonly party: Party;
    } & Record<string, unknown>;
    drafts.write({
      ...saved,
      party: {
        ...saved.party,
        members: saved.party.members.map((member) =>
          member.partyRole === PartyRole.Guest
            ? { ...member, guestLabel: 'Maria' }
            : member,
        ),
      },
    });

    const { store, came } = restored();
    expect(came).toBe(true);
    // Not the grid: it would seat two people the server counts as one.
    expect(store.step()).toBe(BookingFlowStep.Services);
    store.next();
    expect(store.step()).toBe(BookingFlowStep.Services);
    expect(store.error()?.errorCode).toBe(
      'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
    );

    const second = store.guests()[1];
    if (!second) throw new Error('bad fixture');
    expect(store.renameGuest(second.guestId, 'Ani')).toBe(true);
    store.next();
    expect(store.step()).toBe(BookingFlowStep.Schedule);
  });

  it('resumes a REVIEW draft on the schedule, never on the offer nobody re-checked — the day kept', () => {
    const before = createStore(server(), drafts);
    walkToReview(before);
    expect(drafts.raw()?.['bookingFlowStep']).toBe('REVIEW');

    const { store, came } = restored();
    expect(came).toBe(true);
    expect(store.step()).toBe(BookingFlowStep.Schedule);
    expect(store.selectedLocalDate()).toBe('2026-08-03');
    expect(store.selection()).toBeNull();
  });

  it('attaches the visit a signed-out repeat started from, keeping the bag the person built', () => {
    // Signed out at `/book?repeat=`: the visit could not be read, so the
    // person built the bag by hand, then signed in at review.
    const before = createStore(server(), drafts);
    onServices(before);
    before.addLine(SELF, line('svc-beard'));

    const store = afterRoundTrip();
    store.claim(CLIENT);
    store.attachRepeatSource(visit('appt-source'));

    // Their beard, not the old visit's fade — and the edge rides the commit.
    expect(cartLines(store).map((entry) => entry.serviceId)).toEqual([
      'svc-beard',
    ]);
    expect(store.bookedFrom()).toBe('appt-source');
  });

  it('never attaches a rebooking edge to a move', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(visit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim(CLIENT);
    store.attachRepeatSource(visit('appt-source'));

    expect(store.bookedFrom()).toBeNull();
    expect(store.rescheduleOf()).toBe('appt-moving');
  });

  it('keeps a move a move, rather than committing a second booking', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(visit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim(CLIENT);

    expect(store.isRescheduling()).toBe(true);
    expect(store.rescheduleOf()).toBe('appt-moving');
  });

  it('brings the riders back with the move — a restored move skips the landing that read them', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    const carried = before.moveRiders();
    expect(carried).toHaveLength(1);

    const store = afterRoundTrip();
    store.claim(CLIENT);

    expect(store.moveRiders()).toEqual(carried);
  });

  it('brings the visit’s own chairs back with the move, on its own day, so the restored grid still hands them back', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    const released = before.moveRelease();
    expect(released).toHaveLength(4);

    const store = afterRoundTrip();
    store.claim(CLIENT);

    expect(store.moveRelease()).toEqual(released);
    expect(store.moveLocalDate()).toBe('2026-08-03');
  });

  /**
   * The draft `partyVisit`'s move writes, with its stored move replaced by
   * `move` — the way a tampered or older tab would have left it.
   */
  function storedMove(move: Readonly<Record<string, unknown>>): void {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
    const saved = { ...drafts.raw() };
    delete saved['rescheduleRiders'];
    delete saved['rescheduleRelease'];
    drafts.write({ ...saved, ...move });
  }

  const rider = {
    serviceId: 'svc-fade',
    variantId: null,
    barberId: 'petar',
    offsetMinutes: 0,
    durationMinutes: 45,
    setupMinutes: 0,
    cleanupMinutes: 0,
  };

  it('never restores a move with a malformed chair — the draft goes, and the link lands the move again', () => {
    storedMove({
      rescheduleRiders: [rider],
      rescheduleRelease: [
        // Backwards: no chair ends before it starts.
        { barberId: 'ivan', startMinutes: 700, endMinutes: 600 },
        { barberId: 'petar', startMinutes: 600, endMinutes: 700 },
      ],
    });

    const { store, came } = restored();

    // Half a release is a grid deciding on a visit that does not exist.
    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRelease()).toEqual([]);
    expect(drafts.raw()).toBeNull();
  });

  it('never restores a move written without its chairs', () => {
    storedMove({ rescheduleRiders: [] });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(drafts.raw()).toBeNull();
  });

  it('drops the riders with the move when a different account signs in', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim(UserId.of('client-2'));

    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRiders()).toEqual([]);
  });

  it('re-binds the party to a DIFFERENT account that signs in — and judges that person’s visit as theirs', () => {
    // A tab whose restored draft account A claimed, now opened by account B
    // on a move link for B's own visit. Judged against A's account, B's own
    // seat read as a stranger's and the move was refused as the shop's.
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    onServices(before);
    before.addGuest('Maria');

    const store = afterRoundTrip();
    store.claim(UserId.of('client-2'));
    expect(store.party()?.ownerUserId).toBe('client-2');

    const moved = store.rescheduleFrom(
      visit('appt-theirs', 'client-2'),
      guestLabel,
    );
    expect(moved.ok).toBe(true);
    expect(store.moveRefusal()).toBeNull();
    expect(store.rescheduleOf()).toBe('appt-theirs');
    // Their own seat is the cart's `self`, not a rider carried beside it.
    expect(store.moveRiders()).toEqual([]);
    expect(linesPerPerson(store)).toEqual([1]);
    // …and the draft now names them, so the next round trip keeps the move.
    expect((drafts.raw() as { readonly party: Party }).party.ownerUserId).toBe(
      'client-2',
    );
  });

  it('keeps the party on the same account when that account claims again', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(visit('appt-moving'), guestLabel);

    const store = afterRoundTrip();
    store.claim(CLIENT);
    store.claim(CLIENT);

    expect(store.party()?.ownerUserId).toBe('client-1');
    expect(store.rescheduleOf()).toBe('appt-moving');
  });

  it('never restores a move with a malformed rider — a dropped rider is a seat the grid stops checking', () => {
    storedMove({
      rescheduleRiders: [
        // Written before riders carried their terms: the grid could not
        // measure this one, and without it the grid would offer times the
        // server refuses for him.
        {
          serviceId: 'svc-beard',
          variantId: null,
          barberId: 'petar',
          offsetMinutes: 0,
        },
        rider,
      ],
      rescheduleRelease: [],
    });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRiders()).toEqual([]);
    expect(drafts.raw()).toBeNull();
  });

  it.each([
    ['an empty barber', { barberId: '' }],
    ['an empty service', { serviceId: '' }],
    ['a malformed variant', { variantId: '' }],
  ])(
    'never restores a move whose rider has %s — the grid would drop him from its checks',
    (_what, broken) => {
      storedMove({
        rescheduleRiders: [{ ...rider, ...broken }],
        rescheduleRelease: [
          { barberId: 'petar', startMinutes: 600, endMinutes: 700 },
        ],
      });

      const { store, came } = restored();

      // Shaped like a rider, but not one the grid can name: restored, he
      // would pass the guard and then vanish from the rider check.
      expect(came).toBe(false);
      expect(store.isRescheduling()).toBe(false);
      expect(store.availabilityRiders()).toEqual([]);
      expect(drafts.raw()).toBeNull();
    },
  );

  it('never restores a move whose chair names no barber — the release would silently shrink', () => {
    storedMove({
      rescheduleRiders: [],
      rescheduleRelease: [
        { barberId: '', startMinutes: 600, endMinutes: 700 },
        { barberId: 'petar', startMinutes: 600, endMinutes: 700 },
      ],
    });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRelease()).toEqual([]);
    expect(drafts.raw()).toBeNull();
  });

  it('hands the grid every rider and every chair a restored move holds — none dropped on the way', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const { store, came } = restored();

    expect(came).toBe(true);
    expect(store.availabilityRiders()).toHaveLength(store.moveRiders().length);
    expect(store.moveRelease()).toHaveLength(
      (drafts.raw()?.['rescheduleRelease'] as readonly unknown[]).length,
    );
  });

  it('restores a whole move exactly as it was written', () => {
    const before = createStore(server(), drafts);
    before.claim(CLIENT);
    before.rescheduleFrom(partyVisit('appt-moving'), guestLabel);

    const { store, came } = restored();

    expect(came).toBe(true);
    expect(store.moveRiders()).toEqual(before.moveRiders());
    expect(store.moveRelease()).toEqual(before.moveRelease());
  });

  it('starts fresh, and says so, when the stored value is no draft at all', () => {
    drafts.write({ step: 'schedule', party: { guests: [] } });

    const { store, came } = restored();

    expect(came).toBe(false);
    expect(store.step()).toBe(BookingFlowStep.Location);
    expect(drafts.raw()).toBeNull();
  });
});

/*
 * THE LAPSED DAYS OF A RESTORED DRAFT. The draft holds no zone (Law 7.2: the
 * zone is the location's), so a restore cannot tell on its own whether a day
 * has gone by; the schedule step settles it with the shop's TODAY
 * (`settleLapsedDays`, `BookingCartSystem.restore`), once per restore.
 */
describe('BookingFlowStore — a restored draft’s days, judged against the shop’s today', () => {
  let drafts: Drafts;

  beforeEach(() => {
    drafts = jsonDrafts();
  });

  /** A schedule draft with `picked` chosen and `declared` watched. */
  function scheduleDraft(
    picked: string | null,
    declared: readonly string[],
  ): BookingFlowStore {
    const before = createStore(server(), drafts);
    before.selectLocation(CENTER);
    before.next();
    before.addLine(SELF, line('svc-fade'));
    before.next();
    const saved = drafts.raw() ?? {};
    drafts.write({
      ...saved,
      when: FlexibleWhen.of(
        declared.map((day) => DayWindows.wholeDay(localDate(day))),
      ),
      draftLocalDate: picked,
    });
    TestBed.resetTestingModule();
    const store = createStore(server(), drafts);
    expect(store.restore()).toBe(true);
    return store;
  }

  it('keeps every stored day until the shop’s today is known', () => {
    const store = scheduleDraft('2026-08-01', ['2026-08-01', '2026-08-05']);

    expect(store.selectedLocalDate()).toBe('2026-08-01');
    expect(FlexibleWhen.localDates(store.when())).toEqual([
      '2026-08-01',
      '2026-08-05',
    ]);
  });

  it('drops the picked day and the declared days that have gone by — once today is known', () => {
    const store = scheduleDraft('2026-08-01', ['2026-08-01', '2026-08-05']);

    store.settleLapsedDays(localDate('2026-08-03'));

    expect(store.step()).toBe(BookingFlowStep.Schedule);
    expect(store.selectedLocalDate()).toBeNull();
    expect(FlexibleWhen.localDates(store.when())).toEqual(['2026-08-05']);
    // …and the draft says so too.
    expect(drafts.raw()?.['draftLocalDate']).toBeNull();
  });

  it('keeps a day that has not gone by — today included', () => {
    const store = scheduleDraft('2026-08-03', ['2026-08-03']);

    store.settleLapsedDays(localDate('2026-08-03'));

    expect(store.selectedLocalDate()).toBe('2026-08-03');
    expect(FlexibleWhen.localDates(store.when())).toEqual(['2026-08-03']);
  });

  it('settles once per restore — a later day never prunes what the person picked since', () => {
    const store = scheduleDraft(null, []);
    store.settleLapsedDays(localDate('2026-08-03'));
    store.selectDay(localDate('2026-08-04'));

    store.settleLapsedDays(localDate('2026-08-10'));

    expect(store.selectedLocalDate()).toBe('2026-08-04');
  });

  it('settles nothing on a flow nobody restored', () => {
    const store = createStore(server(), drafts);
    store.selectLocation(CENTER);
    store.next();
    store.addLine(SELF, line('svc-fade'));
    store.next();
    store.selectDay(localDate('2026-08-01'));

    store.settleLapsedDays(localDate('2026-08-03'));

    expect(store.selectedLocalDate()).toBe('2026-08-01');
  });
});

/**
 * `partyVisit` after staff re-seated the son: Niko now, half an hour after
 * his father, and Petar's 10:00 chair free for somebody else.
 */
function reseatedPartyVisit(id: string): Appointment {
  return storedVisit(id, [
    { occupant: self('client-1'), barberId: 'ivan', startMinutes: 10 * 60 },
    {
      occupant: companion('client-son'),
      barberId: 'niko',
      startMinutes: 10 * 60 + 30,
    },
  ]);
}

describe('BookingFlowStore — a move re-reads the visit it is moving', () => {
  let appointments: Visits;
  let store: BookingFlowStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    appointments = visits();
    store = createStore(server(), nullDrafts(), appointments);
    store.claim(CLIENT);
    store.rescheduleFrom(partyVisit('appt-moving'), guestLabel);
  });

  function chairs(): string[] {
    return store
      .moveRelease()
      .map((chair) => `${chair.barberId}@${chair.startMinutes}`);
  }

  it('brings who it carries and the chairs it holds in line with the STORED visit, and keeps the bag', async () => {
    const bag = store.cart();
    appointments.answer = Result.ok(reseatedPartyVisit('appt-moving'));

    await store.rereadMove();

    expect(appointments.reads).toBe(1);
    expect(
      store.moveRiders().map((rider) => [rider.barberId, rider.offsetMinutes]),
    ).toEqual([['niko', 30]]);
    // Petar's old chair is somebody else's now: it is no longer handed back.
    expect(chairs().some((chair) => chair.startsWith('petar@'))).toBe(false);
    expect(chairs().some((chair) => chair.startsWith('niko@'))).toBe(true);
    // What the client built is theirs: only the move's facts were re-read.
    expect(store.cart()).toBe(bag);
    expect(store.moveRefusal()).toBeNull();
  });

  it('keeps what it holds when the read FAILS — the server stays the authority', async () => {
    const before = {
      riders: store.moveRiders(),
      release: store.moveRelease(),
    };
    appointments.answer = Result.err(RepositoryError.unavailable());

    await store.rereadMove();

    expect(store.moveRiders()).toBe(before.riders);
    expect(store.moveRelease()).toBe(before.release);
    expect(store.moveRefusal()).toBeNull();
  });

  it('refuses the move, as the landing would, once the visit is gone', async () => {
    appointments.answer = Result.ok(null);

    await store.rereadMove();

    expect(store.moveRefusal()?.moveRefusalReason).toBe(
      MoveRefusalReason.Unavailable,
    );
  });

  it('refuses the move as the shop’s once only a companion is left on it', async () => {
    appointments.answer = Result.ok(companionOnlyVisit('appt-moving'));

    await store.rereadMove();

    expect(store.moveRefusal()?.moveRefusalReason).toBe(
      MoveRefusalReason.CompanionsOnly,
    );
  });

  it('ignores an answer about a move the flow let go of while the read was out', async () => {
    appointments.answer = Result.ok(reseatedPartyVisit('appt-moving'));

    const reading = store.rereadMove();
    // Somebody else signs in: the move they never read is released.
    store.claim(UserId.of('client-2'));
    await reading;

    expect(store.isRescheduling()).toBe(false);
    expect(store.moveRiders()).toEqual([]);
    expect(store.moveRefusal()).toBeNull();
  });

  it('reads nothing when the flow is not a move', async () => {
    TestBed.resetTestingModule();
    const reads = visits();
    const plain = createStore(server(), nullDrafts(), reads);

    await plain.rereadMove();

    expect(reads.reads).toBe(0);
  });
});

// A waitlist match lands on the SCHEDULE step, past the rename that would
// fix two guests under one name, so its placeholders must already differ.
describe('BookingFlowStore.restoreFromWaitlist — one label, one guest', () => {
  const stored = (id: string, seatKey: string) => ({
    lineId: CartLineId.of(id),
    seatKey: SeatKeyText.of(seatKey),
    serviceId: ServiceId.of('svc-fade'),
    variantId: null,
    barberId: null,
    locationId: null,
  });
  const watched = localDate('2026-08-25');
  const createdAtUtcMs = utcMs('2026-08-03T10:00:00.000+03:00');
  /** The stored request: the bag, the shop, the one watched day, open. */
  const request: WaitlistRequest = {
    id: WaitlistRequestId.of('wl-1'),
    ownerUserId: CLIENT,
    locationId: CENTER,
    localDates: [watched],
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(watched, FIXTURE_TIME_ZONE),
    createdAtUtcMs,
    cartSeats: [
      { seatKey: SeatKeyText.of('self'), lines: [stored('line-0', 'self')] },
      {
        seatKey: SeatKeyText.of('guest-0'),
        lines: [stored('line-1', 'guest-0')],
      },
      {
        seatKey: SeatKeyText.of('guest-1'),
        lines: [stored('line-2', 'guest-1')],
      },
    ],
    cartNextSequence: 3,
    flexibleDays: [{ localDate: watched, windows: [] }],
    ...WaitlistLifecycle.open(createdAtUtcMs),
  };

  beforeEach(() => TestBed.resetTestingModule());

  it('names the guests as the catalogue numbers them', () => {
    const store = createStore(server());
    expect(store.restoreFromWaitlist(request, null, guestLabel)).toBe(true);
    expect(guestLabels(store)).toEqual(['Guest 1', 'Guest 2']);
  });

  it('never hands two guests one placeholder, even from copy that drops the number', () => {
    const store = createStore(server());
    expect(store.restoreFromWaitlist(request, null, () => 'Гост')).toBe(true);
    expect(store.step()).toBe(BookingFlowStep.Schedule);
    const party = store.party();
    expect(party === null ? null : Party.sharedLabel(party)).toBeNull();
  });

  it('lands on the day the link names, else the first day the request watches', () => {
    const store = createStore(server());
    store.restoreFromWaitlist(request, '2026-08-27', guestLabel);
    expect(store.selectedLocalDate()).toBe('2026-08-27');
    expect(store.consumeWaitlistArrival()).toBe(true);
    expect(store.consumeWaitlistArrival()).toBe(false);

    TestBed.resetTestingModule();
    const fallback = createStore(server());
    fallback.restoreFromWaitlist(request, null, guestLabel);
    expect(fallback.selectedLocalDate()).toBe('2026-08-25');
  });
});
