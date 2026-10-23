import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BarberPreference,
  BookingPolicy,
  ExceptionEffectRule,
  MinuteRange,
  DayHours,
  Placement,
  PlacementPolicy,
  type StaffTermsOverride,
  type ScheduleVersion,
  ShiftSegment,
  type Seat,
  SeatSubject,
  type ShopNow,
  type ChairTime,
  RequestedSubjectRole,
  type BookingCall,
} from '@core/components';
import {
  BookingError,
  BookingErrorField,
  ShopUnavailableReason,
  BookingStatus,
  type Result,
  Weekday,
  BusyKey,
  Currency,
  type DurationMinutes,
  BarberId,
  LocationId,
  SeatId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  type CustomerId,
  LocalDate,
  EndMinute,
  MinuteOfDay,
  type PriceCents,
  type UtcEpochMs,
} from '@core/primitives';
import type { Service } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  localDate,
  unwrapOk,
  utcMs,
  at,
  cents,
  duration,
  minuteCount,
  serviceFixture,
  termsFixture,
  until,
  resolvedCustomerIds,
  customerOf,
} from '@core/testing';
import {
  type BookingDecision,
  BookingDecisionSystem,
  type BookingSnapshot,
  type BusyWrite,
  type DecideBookingContext,
  type DecideBookingInput,
  type DecisionSchedule,
  type DecisionStandingSeat,
} from './booking-decision.system';
import { PhoneSystem } from './phone.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The 56 cases of apps/functions/src/use-cases/decide-booking.spec.ts,
 * COPIED (never moved) — the legacy spec ran against the shim until
 * `use-cases/*` died in the booking-core flip. Re-targeted: the
 * legacy aggregates are plain structs (`Service`, `ScheduleVersion`, the
 * snapshot's arrays), `isSuccess(r)` is `r.ok`, a legacy error class is its
 * `{ errorCode, field }` struct, and `deps` is the policy, the placement
 * policy, the release and the context the system takes as parameters.
 *
 * Flattened (Law 7.3): every seat is on the request's ONE shop day
 * (`localDate`, T7) at a wall-clock `startMinutes`, "now" is a `ShopNow`,
 * and the one instant the decision stamps — the envelope's `utcEpochMs` —
 * is the edge's, computed here as the callable edge does (`toUtc` of the
 * earliest start in the shop's zone).
 */

const ZONE = FIXTURE_TIME_ZONE;
const OWNER = UserId.of('user-1');
const CENTER = LocationId.of('loc-center');

/** 2026-08-03 is a Monday in Sofia — the fixture roster works Mondays. */
const AUG_3 = localDate('2026-08-03');

/** The shop's "now" on 2026-08-03 at `hh:mm`. */
function nowAt(hour: number, minute = 0): ShopNow {
  return ZonedTimeSystem.shopNow(
    unwrapOk(ZonedTimeSystem.toUtc(AUG_3, at(hour, minute), ZONE)),
    ZONE,
  );
}

const OPEN_9_20 = DayHours.open(at(9), until(20));
/** Mon..Sun — open every day but Sunday. */
const SHOP_HOURS = [
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  DayHours.closed(),
];

const ivan = BarberId.of('ivan');

function fadeService(
  overrides: {
    readonly locationIds?: readonly string[];
    readonly conflictsWith?: readonly string[];
    readonly variants?: readonly {
      id: string;
      name: { bg: string; en: string };
    }[];
  } = {},
): Service {
  return serviceFixture({
    id: ServiceId.of('svc-fade'),
    ...termsFixture(4000, 60),
    locationIds: (overrides.locationIds ?? ['loc-center']).map(LocationId.of),
    conflictsWith: (overrides.conflictsWith ?? []).map(ServiceId.of),
    variants: (overrides.variants ?? []).map((variant) => ({
      variantId: ServiceVariantId.of(variant.id),
      name: variant.name,
    })),
    offerings: [
      { barberId: ivan, overrides: [], ...termsFixture(4500, 30, 0, 10) },
    ],
  });
}

function beardService(conflictsWith: readonly string[] = []): Service {
  return serviceFixture({
    id: ServiceId.of('svc-beard'),
    ...termsFixture(1500, 20),
    locationIds: [CENTER],
    conflictsWith: conflictsWith.map(ServiceId.of),
    offerings: [{ barberId: ivan, overrides: [], ...termsFixture(1500, 20) }],
  });
}

function schedule(
  barber: string,
  options: {
    readonly locationId?: string;
    readonly turnaroundMinutes?: number;
  } = {},
): DecisionSchedule {
  const atShop = LocationId.of(options.locationId ?? 'loc-center');
  const version: ScheduleVersion = {
    seq: 1,
    effectiveFromLocalDate: localDate('2026-01-01'),
    effectiveToLocalDate: null,
    segments: [
      ShiftSegment.of(Weekday.Mon, atShop, at(9), until(18)),
      ShiftSegment.of(Weekday.Tue, atShop, at(9), until(18)),
    ],
  };
  return {
    barberId: BarberId.of(barber),
    versions: [version],
    turnaroundMinutes: minuteCount(options.turnaroundMinutes ?? 0),
  };
}

function snapshot(overrides: Partial<BookingSnapshot> = {}): BookingSnapshot {
  return {
    shopHours: SHOP_HOURS,
    services: [fadeService(), beardService()],
    schedules: [schedule('ivan')],
    busy: [],
    exceptions: [],
    ...overrides,
  };
}

const SELF: BookingCall.SubjectInput = {
  requestedSubjectRole: RequestedSubjectRole.Self,
};
const guestOf = (
  label: string,
  guestKey: string | null = null,
): BookingCall.SubjectInput => ({
  requestedSubjectRole: RequestedSubjectRole.Guest,
  label,
  guestKey,
});
const companionOf = (userId: string): BookingCall.SubjectInput => ({
  requestedSubjectRole: RequestedSubjectRole.Companion,
  companionUserId: userId,
});

function seat(
  overrides: Partial<BookingCall.SeatInput> = {},
): BookingCall.SeatInput {
  return {
    lineId: 'line-1',
    serviceId: 'svc-fade',
    variantId: null,
    barberId: 'ivan',
    barberPreference: null,
    startMinutes: at(12),
    subject: SELF,
    ...overrides,
  };
}

function request(
  seats: readonly BookingCall.SeatInput[] = [seat()],
  overrides: Partial<DecideBookingInput> = {},
): DecideBookingInput {
  return {
    locationId: 'loc-center',
    localDate: AUG_3,
    seats,
    attemptId: null,
    bookedFromAppointmentId: null,
    contact: null,
    placement: null,
    ...overrides,
  };
}

/**
 * The envelope's start instant as the callable edge computes it: the
 * earliest requested start on the request's day, `toUtc` in the shop's
 * zone. A request whose day or starts do not parse is refused by the
 * decision before the instant is read; the day's first instant stands in.
 */
function edgeStartUtcMs(req: DecideBookingInput): UtcEpochMs {
  const day = LocalDate.parse(req.localDate);
  if (!day.ok) return utcMs('2026-08-03T00:00:00+03:00');
  let earliest: MinuteOfDay | null = null;
  for (const requested of req.seats) {
    if (requested.startMinutes === null) continue;
    const start = MinuteOfDay.of(requested.startMinutes);
    if (start.ok && (earliest === null || start.value < earliest)) {
      earliest = start.value;
    }
  }
  if (earliest === null) {
    return ZonedTimeSystem.startOfLocalDay(day.value, ZONE);
  }
  const instant = ZonedTimeSystem.toUtc(day.value, earliest, ZONE);
  return instant.ok
    ? instant.value
    : ZonedTimeSystem.startOfLocalDay(day.value, ZONE);
}

const POLICY = BookingPolicy.DEFAULT;

/** The legacy `deps`: the clock, the owner and the staff relaxations. */
type Deps = {
  readonly now: ShopNow;
  readonly ownerUserId: UserId | null;
  readonly allowOutsideWindow?: boolean;
  readonly allowOverlap?: boolean;
  readonly allowConflictingServices?: boolean;
  readonly standing?: readonly DecisionStandingSeat[];
  readonly release?: readonly ChairTime[];
};

function deps(now: ShopNow = nowAt(8)): Deps {
  return { now, ownerUserId: OWNER };
}

const parsePhone = (raw: string) => {
  const parsed = PhoneSystem.parse(raw, null);
  return parsed.ok ? parsed.value.e164 : null;
};

/**
 * The client records a pipeline resolves before it decides (D29): each
 * account the cart names, `CustomerId.forUser(uid, hash)`.
 */
function resolved(
  req: DecideBookingInput,
  owner: UserId | null,
): ReadonlyMap<UserId, CustomerId> {
  return resolvedCustomerIds(
    BookingDecisionSystem.accountSubjects(req.seats, owner),
  );
}

/** The legacy `decideBooking(request, snapshot, deps)`, over the system. */
function decideBooking(
  req: DecideBookingInput,
  snap: BookingSnapshot,
  given: Deps,
): Result<BookingDecision, BookingError> {
  let counter = 0;
  const outside = given.allowOutsideWindow === true;
  return BookingDecisionSystem.decide(
    req,
    snap,
    POLICY,
    {
      allowOutsideWindow: outside,
      skipMinNotice: outside,
      allowOverlap: given.allowOverlap === true,
      allowConflictingServices: given.allowConflictingServices === true,
    },
    given.release ?? [],
    {
      now: given.now,
      startUtcMs: edgeStartUtcMs(req),
      nextId: () => `id-${counter++}`,
      ownerUserId: given.ownerUserId,
      customerIds: resolved(req, given.ownerUserId),
      termsOverrides: [],
      standing: given.standing ?? [],
      stood: [],
      parsePhone,
    },
  );
}

function unwrap(
  result: Result<BookingDecision, BookingError>,
): BookingDecision {
  if (!result.ok) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const refusal = (result: Result<BookingDecision, BookingError>) =>
  result.ok ? null : result.error;

/** `toBeInstanceOf(CommitBookingPersonDoubleBookedError)`, as a struct. */
const personDoubleBooked = {
  errorCode: 'BOOKING_INVALID_INPUT',
  field: BookingErrorField.PersonOverlap,
};
/** `toBeInstanceOf(CommitBookingDuplicateGuestLabelError)`, as a struct. */
const duplicateGuestLabel = {
  errorCode: 'BOOKING_INVALID_INPUT',
  field: BookingErrorField.GuestLabel,
};

/** A wall-clock busy span on the day. */
const span = (from: MinuteOfDay, to: EndMinute): MinuteRange =>
  MinuteRange.of(from, to);

describe('decide — terms come from the catalog, never the client', () => {
  it('prices the seat from `termsFor(barber, variant)`', () => {
    // The request carries no price at all. Ivan's offering says 45,00 € / 30
    // min with 10 minutes of cleanup — the catalog's numbers, not the
    // service's 40,00 € / 60 min base.
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const [committed] = decision.appointment.seats;

    expect(committed?.priceCents).toBe(4500);
    expect(committed?.durationMinutes).toBe(30);
    expect(committed?.cleanupMinutes).toBe(10);
  });

  it('binds the self seat to the AUTH uid, not to anything in the payload', () => {
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const committed = decision.appointment.seats[0];

    expect(committed?.seatSubject).toBe(SeatSubject.Account);
    if (committed?.seatSubject === SeatSubject.Account) {
      expect(committed.subjectUserId).toBe(OWNER);
    }
  });

  it('claims the chair for setup + service + cleanup, but sells only the service', () => {
    // The client is charged for 30 minutes; the barber is blocked for 40.
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));

    expect(decision.appointment.seats[0]?.durationMinutes).toBe(30);
    expect(
      MinuteRange.durationMinutes(decision.busyWrites[0] as BusyWrite),
    ).toBe(40);
  });

  it('ALLOWS a service with no declared locations — empty means everywhere', () => {
    const result = decideBooking(
      request(),
      snapshot({ services: [fadeService({ locationIds: [] })] }),
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a service the shop does not offer at this location', () => {
    const result = decideBooking(
      request(),
      snapshot({ services: [fadeService({ locationIds: ['loc-mladost'] })] }),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_SERVICE_NOT_AT_LOCATION');
  });

  it('refuses a service that is not in the snapshot at all', () => {
    const result = decideBooking(request(), snapshot({ services: [] }), deps());
    expect(refusal(result)?.errorCode).toBe('BOOKING_UNKNOWN_SERVICE');
  });
});

describe('decide — availability is re-checked, not trusted', () => {
  const busyDay = (spans: readonly MinuteRange[]) => [
    { id: BusyKey.of(ivan, AUG_3), spans },
  ];

  // Copied from decide-waitlist.spec.ts:403 — the commit's decision refuses
  // a blank shop id by itself, before any seat is read.
  it('is refused by the commit’s decision too, should an empty id ever get past the store', () => {
    const bare = snapshot({
      shopHours: [],
      schedules: [],
      busy: [],
      exceptions: [],
    });
    for (const blank of ['', '   ']) {
      const decided = decideBooking(
        request([], { locationId: blank }),
        bare,
        deps(),
      );
      expect(!decided.ok && decided.error).toEqual(
        BookingError.shopUnavailable(blank, ShopUnavailableReason.NotFound),
      );
      expect(!decided.ok && decided.error).toMatchObject({
        errorCode: 'BOOKING_INVALID_INPUT',
        field: 'locationId',
      });
    }
  });

  it('refuses a slot that overlaps an existing booking', () => {
    const result = decideBooking(
      request(),
      snapshot({ busy: busyDay([span(at(12), until(13))]) }),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_SLOT_UNAVAILABLE');
  });

  it('allows a booking that ABUTS an existing one when turnaround is zero', () => {
    // Half-open intervals: [11:00,12:00) and [12:00,12:40) do not overlap.
    expect(
      decideBooking(
        request(),
        snapshot({ busy: busyDay([span(at(11), until(12))]) }),
        deps(),
      ).ok,
    ).toBe(true);
  });

  it('refuses the same abutting booking once the barber has a turnaround', () => {
    // 15 minutes of reset pads the existing block on both sides.
    const result = decideBooking(
      request(),
      snapshot({
        busy: busyDay([span(at(11), until(12))]),
        schedules: [schedule('ivan', { turnaroundMinutes: 15 })],
      }),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_SLOT_UNAVAILABLE');
  });

  describe('a rebuilt visit’s own chairs (`release`)', () => {
    // Stored: the visit being moved (10:00–11:00) merged with a neighbour
    // (11:00–12:00), and a 15-minute reset. Ivan's fade holds the chair 40
    // minutes (30 + 10 of cleanup).
    const ownChair = { startMinutes: at(10), endMinutes: until(11) };
    const moved = snapshot({
      busy: busyDay([span(at(10), until(12))]),
      schedules: [schedule('ivan', { turnaroundMinutes: 15 })],
    });
    const startingAt = (hour: number, minute = 0) =>
      request([seat({ startMinutes: at(hour, minute) })]);

    it('never lets them block where the visit goes next', () => {
      const own = [{ barberId: ivan, ...ownChair }];
      expect(decideBooking(startingAt(10), moved, deps()).ok).toBe(false);
      expect(
        decideBooking(startingAt(10), moved, { ...deps(), release: own }).ok,
      ).toBe(true);
    });

    it('hands them back BEFORE padding, so the neighbour keeps its reset', () => {
      // 10:15–10:55 ends inside the neighbour's reset (10:45–11:00).
      const own = [{ barberId: ivan, ...ownChair }];
      const result = decideBooking(startingAt(10, 15), moved, {
        ...deps(),
        release: own,
      });
      expect(refusal(result)?.errorCode).toBe('BOOKING_SLOT_UNAVAILABLE');
    });

    it('frees nothing of another barber’s', () => {
      const theirs = [{ barberId: BarberId.of('niko'), ...ownChair }];
      expect(
        decideBooking(startingAt(10), moved, { ...deps(), release: theirs }).ok,
      ).toBe(false);
    });
  });

  it('refuses a time outside the barber’s rostered window', () => {
    // Rostered 09:00–18:00; 18:30 is not a window even though the shop is open.
    const result = decideBooking(
      request([seat({ startMinutes: at(18, 30) })]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_SLOT_UNAVAILABLE');
  });

  it('refuses a barber with no roster document', () => {
    const result = decideBooking(
      request(),
      snapshot({ schedules: [] }),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_BARBER_NOT_ROSTERED');
  });

  it('refuses a day a published exception has closed, roster notwithstanding', () => {
    const result = decideBooking(
      request(),
      snapshot({
        exceptions: [
          {
            barberId: ivan,
            localDate: AUG_3,
            ...ExceptionEffectRule.closed(),
          },
        ],
      }),
      deps(),
    );
    // The roster says Ivan works; the exception says not today.
    expect(refusal(result)?.errorCode).toBe('BOOKING_BARBER_NOT_ROSTERED');
  });

  it('clamps to the SHOP’s hours, not just the roster', () => {
    // Rostered 09:00–18:00, but the shop publishes 09:00–13:00 that day.
    const shortDay = [DayHours.open(at(9), until(13)), ...SHOP_HOURS.slice(1)];
    const result = decideBooking(
      request([seat({ startMinutes: at(14) })]),
      snapshot({ shopHours: shortDay }),
      deps(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('decide — policy and party rules', () => {
  it('refuses a booking inside the minimum lead time', () => {
    // Now is 11:00, the default lead is 120 minutes, the seat is at 12:00.
    const result = decideBooking(request(), snapshot(), deps(nowAt(11)));
    expect(refusal(result)?.errorCode).toBe('BOOKING_TOO_SOON');
  });

  it('refuses a party larger than the policy allows', () => {
    const seats = Array.from({ length: POLICY.maxPartySize + 1 }, (_, index) =>
      seat({ lineId: `line-${index}`, subject: guestOf(`Guest ${index}`) }),
    );
    const result = decideBooking(request(seats), snapshot(), deps());
    expect(refusal(result)?.errorCode).toBe('BOOKING_PARTY_TOO_LARGE');
  });

  const conflicting = () =>
    snapshot({
      services: [
        fadeService({ conflictsWith: ['svc-beard'] }),
        beardService(['svc-fade']),
      ],
    });

  it('refuses two conflicting services for ONE person', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
        }),
      ]),
      conflicting(),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_CONFLICTING_SERVICES');
  });

  it('ALLOWS two conflicting services for one person when the shop is booking — a staff edit or placement', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
        }),
      ]),
      conflicting(),
      { ...deps(), allowConflictingServices: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.appointment.seats.length).toBe(2);
  });

  it('ALLOWS the same conflicting pair across two different people', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
          subject: guestOf('Maria'),
        }),
      ]),
      conflicting(),
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a variant the service does not declare', () => {
    const result = decideBooking(
      request([seat({ variantId: 'forged' })]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_INVALID_INPUT');
  });

  it('refuses a MISSING variant when the service declares some', () => {
    // Committing without one would silently charge the service's own terms.
    const result = decideBooking(
      request(),
      snapshot({
        services: [
          fadeService({
            variants: [{ id: 'long', name: { bg: 'Дълга', en: 'Long' } }],
          }),
        ],
      }),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_INVALID_INPUT');
  });

  it('refuses a party whose own seats double-book one barber', () => {
    // Caught by the aggregate's invariants, not by a placement check.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          subject: guestOf('Maria'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_INVARIANT_VIOLATED');
  });

  it('accepts a party served back-to-back by ONE barber', () => {
    // Ivan: fade 12:00–12:30 with 10 min cleanup, then the beard at 12:40.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(12, 40),
          subject: guestOf('Maria'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.ok).toBe(true);
  });
});

describe('decide — the contact rides along as a snapshot', () => {
  const CONTACT = {
    name: 'Емил Тестов',
    phone: '+359896330113',
    email: 'emil@example.com',
    note: 'закъснявам 5 минути',
  } as const;

  it('carries the contact onto the appointment, note and all', () => {
    const decision = unwrap(
      decideBooking(
        request([seat()], { contact: CONTACT }),
        snapshot(),
        deps(),
      ),
    );
    expect(decision.appointment.contactName).toBe('Емил Тестов');
    expect(decision.appointment.contactPhone).toBe('+359896330113');
    expect(decision.appointment.contactEmail).toBe('emil@example.com');
    expect(decision.appointment.contactNote).toBe('закъснявам 5 минути');
  });

  it('commits with no contact at all — an older client still books', () => {
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const { contactName, contactPhone, contactEmail, contactNote } =
      decision.appointment;
    expect([contactName, contactPhone, contactEmail, contactNote]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('REFUSES a contact the shop could not act on', () => {
    const result = decideBooking(
      request([seat()], { contact: { ...CONTACT, phone: '12' } }),
      snapshot(),
      deps(),
    );
    expect(refusal(result)?.errorCode).toBe('BOOKING_INVALID_INPUT');
  });
});

/*
 * STAFF PLACEMENT (owner ruling 2026-08-07 #3, built 2026-09-08). The shop
 * placing its own book: nobody has to own it, the clock and the roster do
 * not gate it, and it is confirmed the moment it is made.
 */
describe('decide — the shop places its own book', () => {
  it('books a walk-in nobody owns, as guest seats, confirmed', () => {
    const decision = unwrap(
      decideBooking(
        request([seat({ subject: guestOf('Случаен клиент') })]),
        snapshot(),
        { ...deps(), ownerUserId: null, allowOutsideWindow: true },
      ),
    );
    expect(decision.appointment.bookingStatus).toBe(BookingStatus.Confirmed);
    expect(decision.appointment.seats[0]?.seatSubject).toBe(
      SeatSubject.Anonymous,
    );
  });

  it('places a booking that has already started — the walk-in is in the chair', () => {
    const decision = decideBooking(
      request([seat({ subject: guestOf('Случаен клиент') })]),
      snapshot(),
      { ...deps(nowAt(12, 10)), ownerUserId: null, allowOutsideWindow: true },
    );
    expect(decision.ok).toBe(true);
  });

  it('keeps a carried companion on their OWN account, never the owner’s', () => {
    const decision = unwrap(
      decideBooking(
        request([
          seat(),
          seat({
            lineId: 'line-2',
            startMinutes: at(13),
            subject: companionOf('son-1'),
          }),
        ]),
        snapshot(),
        { ...deps(), allowOutsideWindow: true },
      ),
    );
    const [booker, companion] = decision.appointment.seats;
    expect(
      booker?.seatSubject === SeatSubject.Account && booker.subjectUserId,
    ).toBe(OWNER);
    expect(
      companion?.seatSubject === SeatSubject.Account && [
        companion.subjectUserId,
        companion.subjectRelationship,
      ],
    ).toEqual(['son-1', 'COMPANION']);
  });

  it('gives every account seat the client record the pipeline resolved, beside its account (D29)', () => {
    const decision = unwrap(
      decideBooking(
        request([
          seat(),
          seat({
            lineId: 'line-2',
            startMinutes: at(13),
            subject: companionOf('son-1'),
          }),
          seat({
            lineId: 'line-3',
            startMinutes: at(14),
            subject: guestOf('Гост'),
          }),
        ]),
        snapshot(),
        { ...deps(), allowOutsideWindow: true },
      ),
    );
    const [booker, companion, guest] = decision.appointment.seats;
    expect(
      booker?.seatSubject === SeatSubject.Account && booker.subjectCustomerId,
    ).toBe(customerOf(OWNER));
    expect(
      companion?.seatSubject === SeatSubject.Account &&
        companion.subjectCustomerId,
    ).toBe(customerOf(UserId.of('son-1')));
    expect(guest).not.toHaveProperty('subjectCustomerId');
    expect(decision.appointment.subjectCustomerIds).toEqual(
      [customerOf(OWNER), customerOf(UserId.of('son-1'))].sort(),
    );
  });

  it('names the accounts a cart needs resolved — the owner for a self seat, each parsed companion, distinct, in seat order', () => {
    const seats = [
      seat({ subject: companionOf('son-1') }),
      seat(),
      seat({ subject: guestOf('Гост') }),
      seat({ subject: companionOf('son-1') }),
      seat({ subject: companionOf('') }),
      seat(),
    ];
    expect(BookingDecisionSystem.accountSubjects(seats, OWNER)).toEqual([
      UserId.of('son-1'),
      OWNER,
    ]);
    // No owner, no self account to resolve; a blank owner is none either.
    expect(BookingDecisionSystem.accountSubjects(seats, null)).toEqual([
      UserId.of('son-1'),
    ]);
    expect(
      BookingDecisionSystem.accountSubjects([seat()], UserId.of(' ')),
    ).toEqual([]);
  });

  it('never invents a record: an account the caller did not resolve is a defect', () => {
    let counter = 0;
    expect(() =>
      BookingDecisionSystem.decide(
        request(),
        snapshot(),
        POLICY,
        PlacementPolicy.staffWalkIn(),
        [],
        {
          now: nowAt(8),
          startUtcMs: edgeStartUtcMs(request()),
          nextId: () => `id-${counter++}`,
          ownerUserId: OWNER,
          customerIds: new Map(),
          termsOverrides: [],
          standing: [],
          stood: [],
          parsePhone,
        },
      ),
    ).toThrow(/client record/);
  });

  it('refuses a carried companion whose id is not a user id', () => {
    const decision = decideBooking(
      request([seat({ subject: companionOf('') })]),
      snapshot(),
      { ...deps(), allowOutsideWindow: true },
    );
    expect(refusal(decision)?.errorCode).toBe('BOOKING_INVALID_INPUT');
  });

  it('still refuses a self seat with nobody to bind it to', () => {
    const decision = decideBooking(request(), snapshot(), {
      ...deps(),
      ownerUserId: null,
      allowOutsideWindow: true,
    });
    expect(decision.ok).toBe(false);
  });

  it('confirms a booking placed on behalf of a client', () => {
    const decision = unwrap(
      decideBooking(request(), snapshot(), {
        ...deps(),
        ownerUserId: UserId.of('client-7'),
        allowOutsideWindow: true,
      }),
    );
    expect(decision.appointment.bookingStatus).toBe(BookingStatus.Confirmed);
    const committed = decision.appointment.seats[0];
    expect(
      committed?.seatSubject === SeatSubject.Account && committed.subjectUserId,
    ).toBe('client-7');
  });
});

/*
 * §11.2 #6: the preference is what somebody asked for, never a default.
 */
describe('decide — the barber preference is recorded, never guessed', () => {
  const prefOf = (requested: Partial<BookingCall.SeatInput>) =>
    unwrap(decideBooking(request([seat(requested)]), snapshot(), deps()))
      .appointment.seats[0]?.barberPreference ?? null;

  it('stores «Всеки» as any and a named barber as specific', () => {
    expect(prefOf({ barberPreference: BarberPreference.Any })).toBe('ANY');
    expect(prefOf({ barberPreference: BarberPreference.Specific })).toBe(
      'SPECIFIC',
    );
  });

  it('stores an omitted preference as unknown, not as a request', () => {
    expect(prefOf({})).toBeNull();
  });
});

/*
 * ── ONE PERSON, ONE CHAIR AT A TIME (owner decision, 2026-09-25) ─────────
 */
describe('decide — one person is never in two chairs at once', () => {
  /** Ivan and Petar both work the day; Petar is on the catalogue's base terms. */
  const twoChairs = () =>
    snapshot({ schedules: [schedule('ivan'), schedule('petar')] });

  it('refuses the booker’s cut and beard side by side in two chairs', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({ lineId: 'line-2', serviceId: 'svc-beard', barberId: 'petar' }),
      ]),
      twoChairs(),
      deps(),
    );
    const error = refusal(result);
    expect(error).toMatchObject(personDoubleBooked);
    // The reason rides on the wire as the field — never the person's key,
    // which can name somebody else's account (the edge keeps it off the wire).
    expect(error?.errorCode).toBe('BOOKING_INVALID_INPUT');
  });

  it('seats the same person back to back across two chairs', () => {
    // Ivan's fade is sold 12:00–12:30 and he sweeps up until 12:40; the
    // person is free at 12:30, so Petar's beard may start then.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          startMinutes: at(12, 30),
        }),
      ]),
      twoChairs(),
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  it('still seats two different people side by side', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: guestOf('Maria'),
        }),
      ]),
      twoChairs(),
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  it('reads one label as one guest — two of its seats may not overlap either', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Maria') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          startMinutes: at(12, 15),
          subject: guestOf(' Maria '),
        }),
      ]),
      twoChairs(),
      deps(),
    );
    expect(refusal(result)).toMatchObject(personDoubleBooked);
  });

  it('holds on the shop’s own paths too — no acknowledgement seats a person twice', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Случаен клиент') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: guestOf('Случаен клиент'),
        }),
      ]),
      twoChairs(),
      {
        ...deps(),
        ownerUserId: null,
        allowOutsideWindow: true,
        allowConflictingServices: true,
        allowOverlap: true,
      },
    );
    expect(refusal(result)).toMatchObject(personDoubleBooked);
  });

  it('refuses exactly the carts that seat somebody twice (property)', () => {
    /** One barber per seat — `b0`…`b4`, as many as the cart can hold. */
    const BARBERS = ['b0', 'b1', 'b2', 'b3', 'b4'];
    const MINUTES = { 'svc-fade': 60, 'svc-beard': 20 } as const;
    const anySeat = fc.record({
      person: fc.constantFrom('self', 'Maria', 'Petko'),
      quarter: fc.integer({ min: 0, max: 8 }),
      serviceId: fc.constantFrom('svc-fade', 'svc-beard'),
    });
    fc.assert(
      fc.property(
        fc.array(anySeat, { minLength: 1, maxLength: 5 }),
        (drafts) => {
          // Every seat on its own barber, so only the PERSON can collide.
          const seats = drafts.map((draft, index) =>
            seat({
              lineId: `line-${index}`,
              serviceId: draft.serviceId,
              barberId: `b${index}`,
              startMinutes: at(12, draft.quarter * 15),
              subject: draft.person === 'self' ? SELF : guestOf(draft.person),
            }),
          );
          const twice = drafts.some((a, i) =>
            drafts.some((b, j) => {
              if (j <= i || a.person !== b.person) return false;
              const aStart = a.quarter * 15;
              const bStart = b.quarter * 15;
              return (
                aStart < bStart + MINUTES[b.serviceId] &&
                bStart < aStart + MINUTES[a.serviceId]
              );
            }),
          );

          const result = decideBooking(
            request(seats),
            snapshot({ schedules: BARBERS.map((id) => schedule(id)) }),
            deps(),
          );
          if (twice) {
            expect(refusal(result)).toMatchObject(personDoubleBooked);
          } else {
            expect(result.ok).toBe(true);
          }
        },
      ),
    );
  });
});

/*
 * ── A PAIR THE VISIT ALREADY HELD ────────────────────────────────────────
 * `nextId` mints `id-0`, `id-1`, … in request order, which is how a rebuild
 * re-mints its stored seat ids — so a standing seat `id-N` IS the request's
 * seat N.
 */
describe('decide — a double seating the visit already held stands', () => {
  const chairs = () =>
    snapshot({
      schedules: [schedule('ivan'), schedule('petar'), schedule('georgi')],
    });

  const walkIn = guestOf('Случаен клиент');
  /** A 30-minute fade with Ivan beside a 20-minute beard with Petar, one label. */
  const heldPair: readonly DecisionStandingSeat[] = [
    {
      seatId: SeatId.of('id-0'),
      subject: walkIn,
      startMinutes: at(12),
      durationMinutes: duration(30),
    },
    {
      seatId: SeatId.of('id-1'),
      subject: walkIn,
      startMinutes: at(12),
      durationMinutes: duration(20),
    },
  ];
  const fade = (overrides: Partial<BookingCall.SeatInput> = {}) =>
    seat({ subject: walkIn, ...overrides });
  const beard = (overrides: Partial<BookingCall.SeatInput> = {}) =>
    seat({
      lineId: 'line-2',
      serviceId: 'svc-beard',
      barberId: 'petar',
      subject: walkIn,
      ...overrides,
    });
  const held = (): Deps => ({ ...deps(), standing: heldPair });

  it('carries the pair while the edit leaves both seats where they stood', () => {
    const result = decideBooking(request([fade(), beard()]), chairs(), held());
    expect(result.ok).toBe(true);
  });

  it('refuses the same pair from a write that does not name it as history', () => {
    expect(
      refusal(decideBooking(request([fade(), beard()]), chairs(), deps())),
    ).toMatchObject(personDoubleBooked);
  });

  it('lets the whole visit be dragged, the pair moving together', () => {
    const result = decideBooking(
      request([
        fade({ startMinutes: at(14) }),
        beard({ startMinutes: at(14) }),
      ]),
      chairs(),
      held(),
    );
    expect(result.ok).toBe(true);
  });

  it('lets one seat of the pair move, stretch or change chair and still overlap', () => {
    for (const edited of [
      beard({ startMinutes: at(12, 5) }),
      beard({ barberId: 'georgi' }),
    ]) {
      expect(
        decideBooking(request([fade(), edited]), chairs(), held()).ok,
      ).toBe(true);
    }
  });

  it('refuses a NEW seat beside a seat that stood, whichever comes first', () => {
    const lone = heldPair.slice(0, 1);
    for (const seats of [
      [fade(), beard()],
      [beard(), fade()],
    ]) {
      expect(
        refusal(
          decideBooking(request(seats), chairs(), {
            ...deps(),
            standing: lone,
          }),
        ),
      ).toMatchObject(personDoubleBooked);
    }
  });

  it('refuses a seat the edit adds beside a pair that stands', () => {
    const result = decideBooking(
      request([
        fade(),
        beard(),
        seat({
          lineId: 'line-3',
          serviceId: 'svc-beard',
          barberId: 'georgi',
          startMinutes: at(12, 10),
          subject: walkIn,
        }),
      ]),
      chairs(),
      held(),
    );
    expect(refusal(result)).toMatchObject(personDoubleBooked);
  });

  it('knows the pair by seat IDENTITY — the same seats under other ids are new', () => {
    const result = decideBooking(request([fade(), beard()]), chairs(), {
      ...deps(),
      standing: heldPair.map((stood, index) => ({
        ...stood,
        seatId: SeatId.of(`seat-${index}`),
      })),
    });
    expect(refusal(result)).toMatchObject(personDoubleBooked);
  });

  it('lets a separating move through: the pair no longer overlaps', () => {
    const result = decideBooking(
      request([fade(), beard({ startMinutes: at(12, 30) })]),
      chairs(),
      held(),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses exactly the edits that seat somebody twice ANEW (property)', () => {
    const MINUTES = { 'svc-fade': 60, 'svc-beard': 20 } as const;
    const anySeat = fc.record({
      person: fc.constantFrom('companion', 'Maria', 'Petko'),
      quarter: fc.integer({ min: 0, max: 8 }),
      serviceId: fc.constantFrom('svc-fade', 'svc-beard'),
      /** Quarters this edit moves the seat by; 0 leaves it where it stood. */
      shift: fc.constantFrom(0, 0, 1, 2, 4),
    });
    fc.assert(
      fc.property(
        fc.array(anySeat, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        (drafts, wholeVisit) => {
          const shiftOf = (index: number) =>
            wholeVisit
              ? (drafts.at(0)?.shift ?? 0)
              : (drafts.at(index)?.shift ?? 0);
          const subjectOf = (person: string): BookingCall.SubjectInput =>
            person === 'companion' ? companionOf('user-2') : guestOf(person);
          const startOf = (quarter: number) => at(12, quarter * 15);
          const standing = drafts.map((draft, index): DecisionStandingSeat => ({
            seatId: SeatId.of(`id-${index}`),
            subject: subjectOf(draft.person),
            startMinutes: startOf(draft.quarter),
            durationMinutes: duration(MINUTES[draft.serviceId]),
          }));
          const seats = drafts.map((draft, index) =>
            seat({
              lineId: `line-${index}`,
              serviceId: draft.serviceId,
              barberId: `b${index}`,
              startMinutes: startOf(draft.quarter + shiftOf(index)),
              subject: subjectOf(draft.person),
            }),
          );
          const overlaps = (
            a: (typeof drafts)[number],
            b: (typeof drafts)[number],
            aShift: number,
            bShift: number,
          ) => {
            const aStart = (a.quarter + aShift) * 15;
            const bStart = (b.quarter + bShift) * 15;
            return (
              a.person === b.person &&
              aStart < bStart + MINUTES[b.serviceId] &&
              bStart < aStart + MINUTES[a.serviceId]
            );
          };
          const refused = drafts.some((a, i) =>
            drafts.some(
              (b, j) =>
                j > i &&
                overlaps(a, b, shiftOf(i), shiftOf(j)) &&
                !overlaps(a, b, 0, 0),
            ),
          );

          const result = decideBooking(
            request(seats),
            snapshot({ schedules: drafts.map((_, i) => schedule(`b${i}`)) }),
            { ...deps(), standing },
          );
          if (refused) {
            expect(refusal(result)).toMatchObject(personDoubleBooked);
          } else {
            expect(result.ok).toBe(true);
          }
        },
      ),
    );
  });
});

/*
 * ── TWO GUESTS, ONE LABEL ────────────────────────────────────────────────
 */
describe('decide — two different guests may not share a label', () => {
  it('refuses two named guests under one label, wherever they sit', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Гост 2', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
          subject: guestOf('Гост 2', 'guest-4'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)).toMatchObject(duplicateGuestLabel);
    expect(refusal(result)?.errorCode).toBe('BOOKING_INVALID_INPUT');
  });

  it('compares the labels as they will be stored — trimmed', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Мария', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
          subject: guestOf('  Мария ', 'guest-2'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)).toMatchObject(duplicateGuestLabel);
  });

  it('takes ONE guest with two services — one key, one label', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Мария', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
          subject: guestOf('Мария', 'guest-1'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  it('asks the label rule of the party — never a copy of it', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this spec's sibling source, located from its own directory.
    const source = readFileSync(
      join(__dirname, 'booking-decision.system.ts'),
      'utf8',
    );
    expect(source).toMatch(/GuestLabelSystem\.sharedLabel\(/);
    expect(source).not.toMatch(/function labelSharedByTwoGuests\b/);
  });

  it('reads one label as one person when the client names nobody — as it always has', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Мария') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(14),
          subject: guestOf('Мария'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.ok).toBe(true);
  });
});

describe('BookingDecisionSystem — the draft and purity', () => {
  it('writes the mirrors, the envelope and the status a commit stores', () => {
    const decision = unwrap(
      decideBooking(
        request([seat()], {
          attemptId: 'attempt-7',
          placement: Placement.Self,
        }),
        snapshot(),
        deps(),
      ),
    );
    const appointment = decision.appointment;
    expect(appointment.id).toBe('attempt-7');
    expect(appointment.ownerUserId).toBe(OWNER);
    expect(appointment.subjectUserIds).toEqual([OWNER]);
    // D29: the client record beside the account, on the mirrors and the seat.
    expect(appointment.ownerCustomerId).toBe(customerOf(OWNER));
    expect(appointment.subjectCustomerIds).toEqual([customerOf(OWNER)]);
    expect(appointment.barberIds).toEqual(['ivan']);
    expect(appointment.busyKeys).toEqual([BusyKey.of(ivan, AUG_3)]);
    // The envelope: the shop day, the sold minutes, and the edge's instant.
    const [only] = appointment.seats as readonly Seat[];
    expect({
      localDate: appointment.localDate,
      startMinutes: appointment.startMinutes,
      endMinutes: appointment.endMinutes,
      utcEpochMs: appointment.utcEpochMs,
    }).toEqual({
      localDate: AUG_3,
      startMinutes: only?.startMinutes,
      endMinutes: at(12, 30),
      utcEpochMs: utcMs('2026-08-03T12:00:00+03:00'),
    });
    expect(appointment.placement).toBe('SELF');
    expect({
      bookingStatus: appointment.bookingStatus,
      confirmedAtUtcMs:
        appointment.bookingStatus === BookingStatus.Confirmed
          ? appointment.confirmedAtUtcMs
          : null,
    }).toEqual({
      bookingStatus: BookingStatus.Confirmed,
      confirmedAtUtcMs: utcMs('2026-08-03T08:00:00+03:00'),
    });
    expect(decision.busyWrites).toEqual([
      {
        barberId: ivan,
        localDate: AUG_3,
        startMinutes: at(12),
        endMinutes: until(12, 40),
      },
    ]);
  });

  it('leaves a booking pending when the shop confirms by hand', () => {
    let counter = 0;
    const result = BookingDecisionSystem.decide(
      request(),
      snapshot(),
      { ...POLICY, autoConfirm: false },
      PlacementPolicy.clientDefault(),
      [],
      {
        now: nowAt(8),
        startUtcMs: edgeStartUtcMs(request()),
        nextId: () => `id-${counter++}`,
        ownerUserId: OWNER,
        customerIds: resolved(request(), OWNER),
        termsOverrides: [],
        standing: [],
        stood: [],
        parsePhone,
      },
    );
    expect(result.ok && result.value.appointment.bookingStatus).toBe(
      BookingStatus.Pending,
    );
  });

  it('carries a staff override and keeps what the catalogue said beside it', () => {
    let counter = 0;
    const result = BookingDecisionSystem.decide(
      request(),
      snapshot(),
      POLICY,
      PlacementPolicy.staffWalkIn(),
      [],
      {
        now: nowAt(8),
        startUtcMs: edgeStartUtcMs(request()),
        nextId: () => `id-${counter++}`,
        ownerUserId: OWNER,
        customerIds: resolved(request(), OWNER),
        termsOverrides: [
          {
            seatKey: SeatKeyText.of('line-1'),
            priceCents: cents(3000),
            currency: null,
            durationMinutes: null,
            setupMinutes: null,
            cleanupMinutes: null,
          },
        ],
        standing: [],
        stood: [],
        parsePhone,
      },
    );
    const terms = result.ok ? result.value.appointment.seats[0] : null;
    expect(terms?.priceCents).toBe(3000);
    expect(terms?.durationMinutes).toBe(30);
    expect(terms?.catalogPriceCents).toBe(4500);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const req = deepFreeze(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMinutes: at(12, 40),
          subject: guestOf('Maria'),
        }),
      ]),
    );
    const snap = deepFreeze(snapshot());
    const now = deepFreeze(nowAt(8));
    const run = () => {
      let counter = 0;
      return BookingDecisionSystem.decide(
        req,
        snap,
        POLICY,
        PlacementPolicy.clientDefault(),
        [],
        {
          now,
          startUtcMs: edgeStartUtcMs(req),
          nextId: () => `id-${counter++}`,
          ownerUserId: OWNER,
          customerIds: resolved(req, OWNER),
          termsOverrides: [],
          standing: [],
          stood: [],
          parsePhone,
        },
      );
    };
    const once = run();
    expect(once.ok).toBe(true);
    expect(run()).toEqual(once);
    expect(snap.services.map((service) => service.id)).toEqual([
      'svc-fade',
      'svc-beard',
    ]);
  });
});

describe('BookingDecisionSystem — every remaining refusal, by its field', () => {
  const field = (result: Result<BookingDecision, BookingError>) =>
    refusal(result)?.errorCode === 'BOOKING_INVALID_INPUT'
      ? (refusal(result) as { field: string }).field
      : refusal(result)?.errorCode;

  /** The decision with a context override — the legacy `deps` cannot reach these. */
  function decideWith(
    req: DecideBookingInput,
    overrides: Partial<DecideBookingContext> = {},
    placement = PlacementPolicy.clientDefault(),
    snap: BookingSnapshot = snapshot(),
  ) {
    let counter = 0;
    return BookingDecisionSystem.decide(req, snap, POLICY, placement, [], {
      now: nowAt(8),
      startUtcMs: edgeStartUtcMs(req),
      nextId: () => `id-${counter++}`,
      ownerUserId: OWNER,
      customerIds: resolved(req, overrides.ownerUserId ?? OWNER),
      termsOverrides: [],
      standing: [],
      stood: [],
      parsePhone,
      ...overrides,
    });
  }
  const override = (
    patch: Partial<StaffTermsOverride> = {},
  ): StaffTermsOverride => ({
    seatKey: SeatKeyText.of('line-1'),
    priceCents: null,
    currency: null,
    durationMinutes: null,
    setupMinutes: null,
    cleanupMinutes: null,
    ...patch,
  });
  /*
   * A CORRUPT carry — figures no brand admits, reaching the decision
   * unparsed. The override is carried server-side from stored seats; the
   * decision keeps its own guards, so a corrupt one is refused where it
   * always was (the legacy shim hands its raw carry straight through).
   */
  const corruptCents = (raw: number) => raw as PriceCents;
  const corruptCurrency = (raw: string) => raw as Currency;
  const corruptDuration = (raw: number) => raw as DurationMinutes;

  it('names no shop for a blank location, and nobody for a blank owner', () => {
    expect(refusal(decideWith(request([seat()], { locationId: ' ' })))).toEqual(
      {
        errorCode: 'BOOKING_INVALID_INPUT',
        field: 'locationId',
        detail: ' ',
        reason: 'not_found',
      },
    );
    expect(field(decideWith(request(), { ownerUserId: UserId.of(' ') }))).toBe(
      'ownerUserId',
    );
  });

  it('refuses a blank barber, an unparsed start and a day outside the calendar', () => {
    expect(field(decideWith(request([seat({ barberId: '' })])))).toBe(
      'seat identifiers',
    );
    expect(field(decideWith(request([seat({ startMinutes: null })])))).toBe(
      'startMinutes',
    );
    // A start off the wall clock, and a shop day no calendar has.
    expect(field(decideWith(request([seat({ startMinutes: 1440 })])))).toBe(
      'startMinutes',
    );
    expect(
      field(decideWith(request([seat()], { localDate: '2026-02-30' }))),
    ).toBe('startMinutes');
  });

  it('refuses a seat beyond the booking horizon', () => {
    expect(
      field(
        decideWith(
          request([seat({ startMinutes: at(10) })], {
            localDate: '2026-11-02',
          }),
        ),
      ),
    ).toBe('BOOKING_BEYOND_HORIZON');
  });

  it('refuses terms nobody can name, a bad price and a bad duration', () => {
    const retired = snapshot({ services: [] });
    const carried = (patch: Partial<StaffTermsOverride>) =>
      decideWith(
        request(),
        { termsOverrides: [override(patch)] },
        PlacementPolicy.clientDefault(),
        retired,
      );
    expect(field(carried({}))).toBe('terms');
    expect(
      field(
        carried({
          priceCents: cents(100),
          currency: corruptCurrency('XXX'),
          durationMinutes: duration(30),
        }),
      ),
    ).toBe('priceCents');
    // A price with no currency to read it in, and no catalogue row to lend one.
    expect(
      field(carried({ priceCents: cents(100), durationMinutes: duration(30) })),
    ).toBe('priceCents');
    expect(
      field(
        carried({
          priceCents: cents(100),
          currency: Currency.EUR,
          durationMinutes: corruptDuration(0),
        }),
      ),
    ).toBe('durationMinutes');
    // A carried seat whose terms are whole stands without its catalogue row.
    expect(
      carried({
        priceCents: cents(100),
        currency: Currency.EUR,
        durationMinutes: duration(30),
      }).ok,
    ).toBe(true);
  });

  it('carries a stored price in the currency it was stored in — a staff edit of a leva visit', () => {
    // Pre-2026 seats are priced in BGN; the staff edit and the client move
    // send every carried seat's stored terms back as an override. The legacy
    // kernel accepted any code it knew (USD, EUR, GBP, BGN), case-insensitive.
    const leva = decideWith(
      request(),
      {
        termsOverrides: [
          // As the legacy kernel read a stored code: case-insensitive.
          override({
            priceCents: cents(3000),
            currency: corruptCurrency('bgn'),
            durationMinutes: duration(30),
          }),
        ],
      },
      PlacementPolicy.staffWalkIn(),
    );
    expect(leva.ok).toBe(true);
    const terms = leva.ok ? leva.value.appointment.seats[0] : null;
    expect(terms?.priceCents).toBe(3000);
    expect(terms?.currency).toBe('BGN');
    // The catalogue (EUR) is kept as provenance — the override differs.
    expect(terms?.catalogPriceCents).toBe(4500);
    // A code no stored price ever carried is still refused, and so is a
    // fractional or negative amount.
    for (const bad of [
      { priceCents: cents(100), currency: corruptCurrency('XXX') },
      { priceCents: cents(100), currency: corruptCurrency(' EUR') },
      { priceCents: corruptCents(10.5), currency: Currency.BGN },
      { priceCents: corruptCents(-1), currency: Currency.BGN },
    ]) {
      expect(
        field(
          decideWith(
            request(),
            {
              termsOverrides: [
                override({ ...bad, durationMinutes: duration(30) }),
              ],
            },
            PlacementPolicy.staffWalkIn(),
          ),
        ),
      ).toBe('priceCents');
    }
  });

  it('keeps the catalogue as provenance when an override changes only a pad', () => {
    // Ivan's offering: 45,00 € / 30 min, cleanup 10. Staff carry cleanup 0.
    const decided = decideWith(
      request(),
      { termsOverrides: [override({ cleanupMinutes: minuteCount(0) })] },
      PlacementPolicy.staffWalkIn(),
    );
    const terms = decided.ok ? decided.value.appointment.seats[0] : null;
    expect(terms?.cleanupMinutes).toBe(0);
    expect(terms?.catalogPriceCents).toBe(4500);
    expect(terms?.catalogDurationMinutes).toBe(30);
  });

  it('parses every foreign id at the door — one that would name a nested document is refused as the blank one is (Law 7.4)', () => {
    expect(refusal(decideWith(request([], { locationId: 'loc/x' })))).toEqual(
      BookingError.shopUnavailable('loc/x', ShopUnavailableReason.NotFound),
    );
    expect(field(decideWith(request([seat({ barberId: 'b/ivan' })])))).toBe(
      'seat identifiers',
    );
    // A service id no catalogue row answers to is refused before the seat is.
    expect(decideWith(request([seat({ serviceId: 'svc/fade' })])).ok).toBe(
      false,
    );
    expect(
      field(decideWith(request([seat({ subject: companionOf('user/2') })]))),
    ).toBe('companion');
    expect(
      field(decideWith(request([seat()], { attemptId: 'attempt/7' }))),
    ).toBe('attemptId');
    // A rebooking link that is no id is dropped, never fatal.
    const linked = decideWith(
      request([seat()], { bookedFromAppointmentId: 'appt/9' }),
    );
    expect(linked.ok && linked.value.appointment.bookedFromAppointmentId).toBe(
      null,
    );
  });

  it('refuses a blank guest label, a blank seat id and a blank appointment id', () => {
    expect(field(decideWith(request([seat({ subject: guestOf('  ') })])))).toBe(
      'guest label',
    );
    expect(field(decideWith(request(), { nextId: () => ' ' }))).toBe('seatId');
    const blankId = decideWith(request([seat()], { attemptId: ' ' }));
    expect(refusal(blankId)).toEqual({
      errorCode: 'BOOKING_INVARIANT_VIOLATED',
      violations: [
        { errorCode: 'SCHEDULING_ID_EMPTY', idType: 'AppointmentId' },
      ],
    });
  });

  it('refuses a booking whose start has already passed', () => {
    const result = decideWith(
      request(),
      { now: nowAt(12) },
      {
        ...PlacementPolicy.clientDefault(),
        skipMinNotice: true,
      },
    );
    expect(refusal(result)).toEqual({
      errorCode: 'BOOKING_INVARIANT_VIOLATED',
      violations: [{ errorCode: 'SCHEDULING_APPOINTMENT_PAST_START_TIME' }],
    });
  });

  it('reports the booker in two chairs at once, and a cart in two currencies', () => {
    const levaBeard = serviceFixture({
      id: ServiceId.of('svc-beard'),
      ...termsFixture(1500, 20, 0, 0, Currency.BGN),
      locationIds: [CENTER],
      offerings: [],
    });
    const twoChairs = snapshot({
      schedules: [schedule('ivan'), schedule('petar')],
      services: [fadeService(), levaBeard],
    });
    // The person rule refuses first on every path; with standing seats it
    // stands, and the aggregate's own invariant still catches the booker.
    const result = decideWith(
      request([
        seat(),
        seat({ lineId: 'line-2', serviceId: 'svc-beard', barberId: 'petar' }),
      ]),
      {
        standing: [
          {
            seatId: SeatId.of('id-0'),
            subject: SELF,
            startMinutes: at(12),
            durationMinutes: duration(30),
          },
          {
            seatId: SeatId.of('id-1'),
            subject: SELF,
            startMinutes: at(12),
            durationMinutes: duration(20),
          },
        ],
      },
      PlacementPolicy.clientDefault(),
      twoChairs,
    );
    expect(refusal(result)).toEqual({
      errorCode: 'BOOKING_INVARIANT_VIOLATED',
      violations: [
        { errorCode: 'SCHEDULING_APPOINTMENT_MULTIPLE_SELF_SEATS' },
        {
          errorCode: 'SCHEDULING_APPOINTMENT_MIXED_CURRENCY',
          expected: 'EUR',
          found: 'BGN',
        },
      ],
    });
  });

  it('refuses a sold service that would run past the shop day’s midnight — one shop day per visit (F-6)', () => {
    // Ivan's fade is sold for 30 minutes: 23:45 would end at 00:15 tomorrow.
    const late = request([seat({ startMinutes: at(23, 45) })]);
    // The client's answer is the slot's (re-pick from a fresh grid)…
    expect(
      field(
        decideWith(
          late,
          {},
          {
            ...PlacementPolicy.clientDefault(),
            skipMinNotice: true,
          },
        ),
      ),
    ).toBe('BOOKING_SLOT_UNAVAILABLE');
    // …the shop's own placement learns it broke the visit's day.
    expect(
      refusal(decideWith(late, {}, PlacementPolicy.staffWalkIn())),
    ).toEqual({ errorCode: 'BOOKING_INVARIANT_VIOLATED', violations: [] });
  });

  it('builds the refusals the stores raise themselves', () => {
    expect(BookingError.unauthenticated()).toEqual({
      errorCode: 'BOOKING_UNAUTHENTICATED',
    });
    expect(
      BookingError.shopUnavailable('loc-x', ShopUnavailableReason.Unlisted),
    ).toEqual({
      errorCode: 'BOOKING_INVALID_INPUT',
      field: 'locationId',
      detail: 'loc-x',
      reason: 'unlisted',
    });
  });
});
