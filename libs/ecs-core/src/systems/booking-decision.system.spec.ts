import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy } from '../components/booking-policy.data';
import { BusyKey } from '../components/busy-key.data';
import { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { ExceptionEffect } from '../components/exception-effect.data';
import { DayHours } from '../components/opening-hours.data';
import { PlacementPolicy } from '../components/placement-policy.data';
import type { Result } from '../components/result.data';
import {
  type ScheduleVersion,
  ShiftSegment,
} from '../components/schedule-version.data';
import { Seat, SeatSubjectKind } from '../components/seat.data';
import {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import { TimeInterval } from '../components/time-interval.data';
import { Weekday } from '../components/weekday.data';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { type ServiceEntity, ServiceId } from '../entities/service.entity';
import { dayTableFixture, deepFreeze, serviceFixture } from '../testing';
import type { ChairTime } from './availability.system';
import {
  type BookingDecision,
  BookingDecisionSystem,
  type BookingSnapshot,
  type DecideBookingRequest,
  type DecisionSchedule,
  type RequestedSeat,
  type DecisionStandingSeat,
} from './booking-decision.system';
import type { RequestedSubject } from './guest-label.system';
import {
  BookingCommitError,
  BookingCommitField,
  ShopUnavailableReason,
} from '../components/booking-commit-errors.data';
import { PhoneSystem } from './phone.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The 56 cases of apps/functions/src/use-cases/decide-booking.spec.ts,
 * COPIED (never moved) — the legacy spec keeps running against the shim
 * until `use-cases/*` dies in the booking-core flip. Re-targeted: the
 * legacy aggregates are plain structs (`ServiceEntity`, `ScheduleVersion`,
 * the snapshot's arrays), `isSuccess(r)` is `r.ok`, a legacy error class is
 * its `{ code, field }` struct, and `deps` is the policy, the placement
 * policy, the release and the context the system takes as parameters.
 */

const ZONE = 'Europe/Sofia';
const OWNER = 'user-1';
const CENTER = LocationId.of('loc-center');

/** Late July to the end of November: today, every seat and the horizon. */
const DAYS = dayTableFixture('2026-07-25', '2026-11-30', ZONE);
/** 2026-08-03 is a Monday in Sofia — the fixture roster works Mondays. */
const AUG_3 = DayOffset.find(DayKey.of('2026-08-03'), DAYS) as DayOffset;

function at(hour: number, minute = 0): number {
  return ZonedTimeSystem.instantOf(AUG_3, hour * 60 + minute);
}
const plusMinutes = (ms: number, minutes: number) => ms + minutes * 60_000;

const OPEN_9_20 = DayHours.open(9 * 60, 20 * 60);
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
): ServiceEntity {
  return serviceFixture({
    id: ServiceId.of('svc-fade'),
    baseTerms: ServiceTerms.unpadded(4000, 'EUR', 60),
    locationIds: (overrides.locationIds ?? ['loc-center']).map(LocationId.of),
    conflictsWith: (overrides.conflictsWith ?? []).map(ServiceId.of),
    variants: (overrides.variants ?? []).map((variant) => ({
      id: ServiceVariantId.of(variant.id),
      name: variant.name,
    })),
    offerings: [
      {
        barberId: ivan,
        base: ServiceTerms.of(4500, 'EUR', 30, 0, 10),
        overrides: [],
      },
    ],
  });
}

function beardService(conflictsWith: readonly string[] = []): ServiceEntity {
  return serviceFixture({
    id: ServiceId.of('svc-beard'),
    baseTerms: ServiceTerms.unpadded(1500, 'EUR', 20),
    locationIds: [CENTER],
    conflictsWith: conflictsWith.map(ServiceId.of),
    offerings: [
      {
        barberId: ivan,
        base: ServiceTerms.unpadded(1500, 'EUR', 20),
        overrides: [],
      },
    ],
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
    effectiveFromDayKey: DayKey.of('2026-01-01'),
    effectiveToDayKey: null,
    segments: [
      ShiftSegment.of(Weekday.Mon, atShop, 9 * 60, 18 * 60),
      ShiftSegment.of(Weekday.Tue, atShop, 9 * 60, 18 * 60),
    ],
  };
  return {
    barberId: BarberId.of(barber),
    versions: [version],
    turnaroundMinutes: options.turnaroundMinutes ?? 0,
  };
}

function snapshot(overrides: Partial<BookingSnapshot> = {}): BookingSnapshot {
  return {
    zone: ZONE,
    shopHours: SHOP_HOURS,
    services: [fadeService(), beardService()],
    schedules: [schedule('ivan')],
    busy: [],
    exceptions: [],
    ...overrides,
  };
}

const SELF: RequestedSubject = { kind: 'self' };
const guestOf = (label: string, guestKey: string | null = null) =>
  ({ kind: 'guest', label, guestKey }) as const;

function seat(overrides: Partial<RequestedSeat> = {}): RequestedSeat {
  return {
    lineId: 'line-1',
    serviceId: 'svc-fade',
    variantId: null,
    barberId: 'ivan',
    barberPref: null,
    startMs: at(12),
    subject: SELF,
    ...overrides,
  };
}

function request(
  seats: readonly RequestedSeat[] = [seat()],
  overrides: Partial<DecideBookingRequest> = {},
): DecideBookingRequest {
  return {
    locationId: 'loc-center',
    seats,
    attemptId: null,
    bookedFromAppointmentId: null,
    contact: null,
    placement: null,
    ...overrides,
  };
}

const POLICY = BookingPolicy.DEFAULT;

/** The legacy `deps`: the clock, the owner and the staff relaxations. */
type Deps = {
  readonly nowMs: number;
  readonly ownerUserId: string | null;
  readonly allowOutsideWindow?: boolean;
  readonly allowOverlap?: boolean;
  readonly allowConflictingServices?: boolean;
  readonly standing?: readonly DecisionStandingSeat[];
  readonly release?: readonly ChairTime[];
};

function deps(nowMs: number = at(8)): Deps {
  return { nowMs, ownerUserId: OWNER };
}

const parsePhone = (raw: string) => {
  const parsed = PhoneSystem.parse(raw, null);
  return parsed.ok ? parsed.value.e164 : null;
};

/** The legacy `decideBooking(request, snapshot, deps)`, over the system. */
function decideBooking(
  req: DecideBookingRequest,
  snap: BookingSnapshot,
  given: Deps,
): Result<BookingDecision, BookingCommitError> {
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
      nowMs: given.nowMs,
      nextId: () => `id-${counter++}`,
      days: DAYS,
      ownerUserId: given.ownerUserId,
      termsOverrides: [],
      standing: given.standing ?? [],
      stood: [],
      parsePhone,
    },
  );
}

function unwrap(
  result: Result<BookingDecision, BookingCommitError>,
): BookingDecision {
  if (!result.ok) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const refusal = (result: Result<BookingDecision, BookingCommitError>) =>
  result.ok ? null : result.error;

/** `toBeInstanceOf(CommitBookingPersonDoubleBookedError)`, as a struct. */
const personDoubleBooked = {
  code: 'booking.commit.invalid_input',
  field: BookingCommitField.PersonOverlap,
};
/** `toBeInstanceOf(CommitBookingDuplicateGuestLabelError)`, as a struct. */
const duplicateGuestLabel = {
  code: 'booking.commit.invalid_input',
  field: BookingCommitField.GuestLabel,
};

describe('decide — terms come from the catalog, never the client', () => {
  it('prices the seat from `termsFor(barber, variant)`', () => {
    // The request carries no price at all. Ivan's offering says 45,00 € / 30
    // min with 10 minutes of cleanup — the catalog's numbers, not the
    // service's 40,00 € / 60 min base.
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const [committed] = decision.appointment.seats;

    expect(committed?.terms.priceMinorUnits).toBe(4500);
    expect(committed?.terms.durationMinutes).toBe(30);
    expect(committed?.terms.cleanupMinutes).toBe(10);
  });

  it('binds the self seat to the AUTH uid, not to anything in the payload', () => {
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const subject = decision.appointment.seats[0]?.subject;

    expect(subject?.kind).toBe('account');
    if (subject?.kind === SeatSubjectKind.Account) {
      expect(subject.userId).toBe(OWNER);
    }
  });

  it('claims the chair for setup + service + cleanup, but sells only the service', () => {
    // The client is charged for 30 minutes; the barber is blocked for 40.
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));

    expect(decision.appointment.seats[0]?.terms.durationMinutes).toBe(30);
    expect(
      TimeInterval.durationMinutes(
        decision.busyWrites[0]?.interval as TimeInterval,
      ),
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
    expect(refusal(result)?.code).toBe(
      'booking.commit.service_not_at_location',
    );
  });

  it('refuses a service that is not in the snapshot at all', () => {
    const result = decideBooking(request(), snapshot({ services: [] }), deps());
    expect(refusal(result)?.code).toBe('booking.commit.unknown_service');
  });
});

describe('decide — availability is re-checked, not trusted', () => {
  const busyDay = (spans: readonly TimeInterval[]) => [
    { id: BusyKey.of(ivan, AUG_3.dayKey), spans },
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
        BookingCommitError.shopUnavailable(
          blank,
          ShopUnavailableReason.NotFound,
        ),
      );
      expect(!decided.ok && decided.error).toMatchObject({
        code: 'booking.commit.invalid_input',
        field: 'locationId',
      });
    }
  });

  it('refuses a slot that overlaps an existing booking', () => {
    const result = decideBooking(
      request(),
      snapshot({ busy: busyDay([TimeInterval.of(at(12), at(13))]) }),
      deps(),
    );
    expect(refusal(result)?.code).toBe('booking.commit.slot_unavailable');
  });

  it('allows a booking that ABUTS an existing one when turnaround is zero', () => {
    // Half-open intervals: [11:00,12:00) and [12:00,12:40) do not overlap.
    expect(
      decideBooking(
        request(),
        snapshot({ busy: busyDay([TimeInterval.of(at(11), at(12))]) }),
        deps(),
      ).ok,
    ).toBe(true);
  });

  it('refuses the same abutting booking once the barber has a turnaround', () => {
    // 15 minutes of reset pads the existing block on both sides.
    const result = decideBooking(
      request(),
      snapshot({
        busy: busyDay([TimeInterval.of(at(11), at(12))]),
        schedules: [schedule('ivan', { turnaroundMinutes: 15 })],
      }),
      deps(),
    );
    expect(refusal(result)?.code).toBe('booking.commit.slot_unavailable');
  });

  describe('a rebuilt visit’s own chairs (`release`)', () => {
    // Stored: the visit being moved (10:00–11:00) merged with a neighbour
    // (11:00–12:00), and a 15-minute reset. Ivan's fade holds the chair 40
    // minutes (30 + 10 of cleanup).
    const ownChair = TimeInterval.of(at(10), at(11));
    const moved = snapshot({
      busy: busyDay([TimeInterval.of(at(10), at(12))]),
      schedules: [schedule('ivan', { turnaroundMinutes: 15 })],
    });
    const startingAt = (hour: number, minute = 0) =>
      request([seat({ startMs: at(hour, minute) })]);

    it('never lets them block where the visit goes next', () => {
      const own = [{ barberId: ivan, occupied: ownChair }];
      expect(decideBooking(startingAt(10), moved, deps()).ok).toBe(false);
      expect(
        decideBooking(startingAt(10), moved, { ...deps(), release: own }).ok,
      ).toBe(true);
    });

    it('hands them back BEFORE padding, so the neighbour keeps its reset', () => {
      // 10:15–10:55 ends inside the neighbour's reset (10:45–11:00).
      const own = [{ barberId: ivan, occupied: ownChair }];
      const result = decideBooking(startingAt(10, 15), moved, {
        ...deps(),
        release: own,
      });
      expect(refusal(result)?.code).toBe('booking.commit.slot_unavailable');
    });

    it('frees nothing of another barber’s', () => {
      const theirs = [{ barberId: BarberId.of('niko'), occupied: ownChair }];
      expect(
        decideBooking(startingAt(10), moved, { ...deps(), release: theirs }).ok,
      ).toBe(false);
    });
  });

  it('refuses a time outside the barber’s rostered window', () => {
    // Rostered 09:00–18:00; 18:30 is not a window even though the shop is open.
    const result = decideBooking(
      request([seat({ startMs: at(18, 30) })]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)?.code).toBe('booking.commit.slot_unavailable');
  });

  it('refuses a barber with no roster document', () => {
    const result = decideBooking(
      request(),
      snapshot({ schedules: [] }),
      deps(),
    );
    expect(refusal(result)?.code).toBe('booking.commit.barber_not_rostered');
  });

  it('refuses a day a published exception has closed, roster notwithstanding', () => {
    const result = decideBooking(
      request(),
      snapshot({
        exceptions: [
          {
            barberId: ivan,
            dayKey: AUG_3.dayKey,
            effect: ExceptionEffect.closed(),
          },
        ],
      }),
      deps(),
    );
    // The roster says Ivan works; the exception says not today.
    expect(refusal(result)?.code).toBe('booking.commit.barber_not_rostered');
  });

  it('clamps to the SHOP’s hours, not just the roster', () => {
    // Rostered 09:00–18:00, but the shop publishes 09:00–13:00 that day.
    const shortDay = [DayHours.open(9 * 60, 13 * 60), ...SHOP_HOURS.slice(1)];
    const result = decideBooking(
      request([seat({ startMs: at(14) })]),
      snapshot({ shopHours: shortDay }),
      deps(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('decide — policy and party rules', () => {
  it('refuses a booking inside the minimum lead time', () => {
    // Now is 11:00, the default lead is 120 minutes, the seat is at 12:00.
    const result = decideBooking(request(), snapshot(), deps(at(11)));
    expect(refusal(result)?.code).toBe('booking.commit.too_soon');
  });

  it('refuses a party larger than the policy allows', () => {
    const seats = Array.from({ length: POLICY.maxPartySize + 1 }, (_, index) =>
      seat({ lineId: `line-${index}`, subject: guestOf(`Guest ${index}`) }),
    );
    const result = decideBooking(request(seats), snapshot(), deps());
    expect(refusal(result)?.code).toBe('booking.commit.party_too_large');
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
        seat({ lineId: 'line-2', serviceId: 'svc-beard', startMs: at(14) }),
      ]),
      conflicting(),
      deps(),
    );
    expect(refusal(result)?.code).toBe('booking.commit.conflicting_services');
  });

  it('ALLOWS two conflicting services for one person when the shop is booking — a staff edit or placement', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({ lineId: 'line-2', serviceId: 'svc-beard', startMs: at(14) }),
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
          startMs: at(14),
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
    expect(refusal(result)?.code).toBe('booking.commit.invalid_input');
  });

  it('refuses a MISSING variant when the service declares some', () => {
    // Committing without one would silently charge `baseTerms`.
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
    expect(refusal(result)?.code).toBe('booking.commit.invalid_input');
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
    expect(refusal(result)?.code).toBe('booking.commit.invariant_violated');
  });

  it('accepts a party served back-to-back by ONE barber', () => {
    // Ivan: fade 12:00–12:30 with 10 min cleanup, then the beard at 12:40.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMs: at(12, 40),
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
    expect(decision.appointment.contact?.name).toBe('Емил Тестов');
    expect(decision.appointment.contact?.phone).toBe('+359896330113');
    expect(decision.appointment.contact?.email).toBe('emil@example.com');
    expect(decision.appointment.contact?.note).toBe('закъснявам 5 минути');
  });

  it('commits with no contact at all — an older client still books', () => {
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    expect(decision.appointment.contact).toBeNull();
  });

  it('REFUSES a contact the shop could not act on', () => {
    const result = decideBooking(
      request([seat()], { contact: { ...CONTACT, phone: '12' } }),
      snapshot(),
      deps(),
    );
    expect(refusal(result)?.code).toBe('booking.commit.invalid_input');
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
    expect(decision.appointment.bookingStatus.kind).toBe('confirmed');
    expect(decision.appointment.seats[0]?.subject.kind).toBe('anonymous');
  });

  it('places a booking that has already started — the walk-in is in the chair', () => {
    const decision = decideBooking(
      request([seat({ subject: guestOf('Случаен клиент') })]),
      snapshot(),
      { ...deps(at(12, 10)), ownerUserId: null, allowOutsideWindow: true },
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
            startMs: at(13),
            subject: { kind: 'companion', userId: 'son-1' },
          }),
        ]),
        snapshot(),
        { ...deps(), allowOutsideWindow: true },
      ),
    );
    const [booker, companion] = decision.appointment.seats.map(
      (decided) => decided.subject,
    );
    expect(booker?.kind === 'account' && booker.userId).toBe(OWNER);
    expect(
      companion?.kind === 'account' && [
        companion.userId,
        companion.relationship,
      ],
    ).toEqual(['son-1', 'companion']);
  });

  it('refuses a carried companion whose id is not a user id', () => {
    const decision = decideBooking(
      request([seat({ subject: { kind: 'companion', userId: '' } })]),
      snapshot(),
      { ...deps(), allowOutsideWindow: true },
    );
    expect(refusal(decision)?.code).toBe('booking.commit.invalid_input');
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
        ownerUserId: 'client-7',
        allowOutsideWindow: true,
      }),
    );
    expect(decision.appointment.bookingStatus.kind).toBe('confirmed');
    const subject = decision.appointment.seats[0]?.subject;
    expect(subject?.kind === 'account' && subject.userId).toBe('client-7');
  });
});

/*
 * §11.2 #6: the preference is what somebody asked for, never a default.
 */
describe('decide — the barber preference is recorded, never guessed', () => {
  const prefOf = (requested: Partial<RequestedSeat>) =>
    unwrap(decideBooking(request([seat(requested)]), snapshot(), deps()))
      .appointment.seats[0]?.barberPref ?? null;

  it('stores «Всеки» as any and a named barber as specific', () => {
    expect(prefOf({ barberPref: 'any' })).toBe('any');
    expect(prefOf({ barberPref: 'specific' })).toBe('specific');
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
    // which can name somebody else's account (the shim keeps it off the wire).
    expect(error?.code).toBe('booking.commit.invalid_input');
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
          startMs: at(12, 30),
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
          startMs: at(12, 15),
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
              startMs: plusMinutes(at(12), draft.quarter * 15),
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
    { id: 'id-0', subject: walkIn, startMs: at(12), durationMinutes: 30 },
    { id: 'id-1', subject: walkIn, startMs: at(12), durationMinutes: 20 },
  ];
  const fade = (overrides: Partial<RequestedSeat> = {}) =>
    seat({ subject: walkIn, ...overrides });
  const beard = (overrides: Partial<RequestedSeat> = {}) =>
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
      request([fade({ startMs: at(14) }), beard({ startMs: at(14) })]),
      chairs(),
      held(),
    );
    expect(result.ok).toBe(true);
  });

  it('lets one seat of the pair move, stretch or change chair and still overlap', () => {
    for (const edited of [
      beard({ startMs: at(12, 5) }),
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
          startMs: at(12, 10),
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
        id: `seat-${index}`,
      })),
    });
    expect(refusal(result)).toMatchObject(personDoubleBooked);
  });

  it('lets a separating move through: the pair no longer overlaps', () => {
    const result = decideBooking(
      request([fade(), beard({ startMs: at(12, 30) })]),
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
          const subjectOf = (person: string): RequestedSubject =>
            person === 'companion'
              ? { kind: 'companion', userId: 'user-2' }
              : guestOf(person);
          const startOf = (quarter: number) =>
            plusMinutes(at(12), quarter * 15);
          const standing = drafts.map((draft, index) => ({
            id: `id-${index}`,
            subject: subjectOf(draft.person),
            startMs: startOf(draft.quarter),
            durationMinutes: MINUTES[draft.serviceId],
          }));
          const seats = drafts.map((draft, index) =>
            seat({
              lineId: `line-${index}`,
              serviceId: draft.serviceId,
              barberId: `b${index}`,
              startMs: startOf(draft.quarter + shiftOf(index)),
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
          startMs: at(14),
          subject: guestOf('Гост 2', 'guest-4'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(refusal(result)).toMatchObject(duplicateGuestLabel);
    expect(refusal(result)?.code).toBe('booking.commit.invalid_input');
  });

  it('compares the labels as they will be stored — trimmed', () => {
    const result = decideBooking(
      request([
        seat({ subject: guestOf('Мария', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMs: at(14),
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
          startMs: at(14),
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
          startMs: at(14),
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
        request([seat()], { attemptId: 'attempt-7', placement: 'self' }),
        snapshot(),
        deps(),
      ),
    );
    const appointment = decision.appointment;
    expect(appointment.id).toBe('attempt-7');
    expect(appointment.ownerUserId).toBe(OWNER);
    expect(appointment.subjectUserIds).toEqual([OWNER]);
    expect(appointment.barberIds).toEqual(['ivan']);
    expect(appointment.busyKeys).toEqual([BusyKey.of(ivan, AUG_3.dayKey)]);
    expect(appointment.timeInterval).toEqual(
      Seat.interval(appointment.seats[0] as Seat),
    );
    expect(appointment.placement).toBe('self');
    expect(appointment.bookingStatus).toEqual({
      kind: 'confirmed',
      atMs: at(8),
    });
    expect(decision.busyWrites).toEqual([
      {
        barberId: ivan,
        dayKey: AUG_3.dayKey,
        interval: TimeInterval.of(at(12), at(12, 40)),
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
        nowMs: at(8),
        nextId: () => `id-${counter++}`,
        days: DAYS,
        ownerUserId: OWNER,
        termsOverrides: [],
        standing: [],
        stood: [],
        parsePhone,
      },
    );
    expect(result.ok && result.value.appointment.bookingStatus.kind).toBe(
      'pending',
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
        nowMs: at(8),
        nextId: () => `id-${counter++}`,
        days: DAYS,
        ownerUserId: OWNER,
        termsOverrides: [
          {
            seatKey: 'line-1',
            priceMinorUnits: 3000,
            currencyCode: null,
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
    const terms = result.ok ? result.value.appointment.seats[0]?.terms : null;
    expect(terms?.priceMinorUnits).toBe(3000);
    expect(terms?.durationMinutes).toBe(30);
    expect(terms?.catalogPriceMinorUnits).toBe(4500);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const req = deepFreeze(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startMs: at(12, 40),
          subject: guestOf('Maria'),
        }),
      ]),
    );
    const snap = deepFreeze(snapshot());
    const days = deepFreeze([...DAYS]);
    const run = () => {
      let counter = 0;
      return BookingDecisionSystem.decide(
        req,
        snap,
        POLICY,
        PlacementPolicy.clientDefault(),
        [],
        {
          nowMs: at(8),
          nextId: () => `id-${counter++}`,
          days,
          ownerUserId: OWNER,
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
  const field = (result: Result<BookingDecision, BookingCommitError>) =>
    refusal(result)?.code === 'booking.commit.invalid_input'
      ? (refusal(result) as { field: string }).field
      : refusal(result)?.code;

  /** The decision with a context override — the legacy `deps` cannot reach these. */
  function decideWith(
    req: DecideBookingRequest,
    overrides: Partial<Parameters<typeof BookingDecisionSystem.decide>[5]> = {},
    placement = PlacementPolicy.clientDefault(),
    snap: BookingSnapshot = snapshot(),
  ) {
    let counter = 0;
    return BookingDecisionSystem.decide(req, snap, POLICY, placement, [], {
      nowMs: at(8),
      nextId: () => `id-${counter++}`,
      days: DAYS,
      ownerUserId: OWNER,
      termsOverrides: [],
      standing: [],
      stood: [],
      parsePhone,
      ...overrides,
    });
  }
  const override = (
    patch: Partial<Record<string, number | string | null>>,
  ) => ({
    seatKey: 'line-1',
    priceMinorUnits: null,
    currencyCode: null,
    durationMinutes: null,
    setupMinutes: null,
    cleanupMinutes: null,
    ...patch,
  });

  it('names no shop for a blank location, and nobody for a blank owner', () => {
    expect(refusal(decideWith(request([seat()], { locationId: ' ' })))).toEqual(
      {
        code: 'booking.commit.invalid_input',
        field: 'locationId',
        detail: ' ',
        reason: 'not_found',
      },
    );
    expect(field(decideWith(request(), { ownerUserId: ' ' }))).toBe(
      'ownerUserId',
    );
  });

  it('refuses a blank barber, an unparsed start and a day outside the table', () => {
    expect(field(decideWith(request([seat({ barberId: '' })])))).toBe(
      'seat identifiers',
    );
    expect(field(decideWith(request([seat({ startMs: null })])))).toBe(
      'startIso',
    );
    expect(
      field(
        decideWith(request([seat({ startMs: at(12) + 400 * 86_400_000 })])),
      ),
    ).toBe('startIso');
  });

  it('refuses a seat beyond the booking horizon', () => {
    const december = DayOffset.find(DayKey.of('2026-11-02'), DAYS) as DayOffset;
    expect(
      field(
        decideWith(
          request([
            seat({ startMs: ZonedTimeSystem.instantOf(december, 600) }),
          ]),
        ),
      ),
    ).toBe('booking.commit.beyond_horizon');
  });

  it('refuses terms nobody can name, a bad price and a bad duration', () => {
    const retired = snapshot({ services: [] });
    const carried = (patch: Partial<Record<string, number | string | null>>) =>
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
          priceMinorUnits: 100,
          currencyCode: 'XXX',
          durationMinutes: 30,
        }),
      ),
    ).toBe('priceMinorUnits');
    expect(
      field(
        carried({
          priceMinorUnits: 100,
          currencyCode: 'EUR',
          durationMinutes: 0,
        }),
      ),
    ).toBe('durationMinutes');
    // A carried seat whose terms are whole stands without its catalogue row.
    expect(
      carried({
        priceMinorUnits: 100,
        currencyCode: 'EUR',
        durationMinutes: 30,
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
          override({
            priceMinorUnits: 3000,
            currencyCode: 'bgn',
            durationMinutes: 30,
          }),
        ],
      },
      PlacementPolicy.staffWalkIn(),
    );
    expect(leva.ok).toBe(true);
    const terms = leva.ok ? leva.value.appointment.seats[0]?.terms : null;
    expect(terms?.priceMinorUnits).toBe(3000);
    expect(terms?.currencyCode).toBe('BGN');
    // The catalogue (EUR) is kept as provenance — the override differs.
    expect(terms?.catalogPriceMinorUnits).toBe(4500);
    // A code no stored price ever carried is still refused, and so is a
    // fractional or negative amount.
    for (const bad of [
      { priceMinorUnits: 100, currencyCode: 'XXX' },
      { priceMinorUnits: 100, currencyCode: ' EUR' },
      { priceMinorUnits: 10.5, currencyCode: 'BGN' },
      { priceMinorUnits: -1, currencyCode: 'BGN' },
    ]) {
      expect(
        field(
          decideWith(
            request(),
            { termsOverrides: [override({ ...bad, durationMinutes: 30 })] },
            PlacementPolicy.staffWalkIn(),
          ),
        ),
      ).toBe('priceMinorUnits');
    }
  });

  it('keeps the catalogue as provenance when an override changes only a pad', () => {
    // Ivan's offering: 45,00 € / 30 min, cleanup 10. Staff carry cleanup 0.
    const decided = decideWith(
      request(),
      { termsOverrides: [override({ cleanupMinutes: 0 })] },
      PlacementPolicy.staffWalkIn(),
    );
    const terms = decided.ok ? decided.value.appointment.seats[0]?.terms : null;
    expect(terms?.cleanupMinutes).toBe(0);
    expect(terms?.catalogPriceMinorUnits).toBe(4500);
    expect(terms?.catalogDurationMinutes).toBe(30);
  });

  it('refuses a blank guest label, a blank seat id and a blank appointment id', () => {
    expect(field(decideWith(request([seat({ subject: guestOf('  ') })])))).toBe(
      'guest label',
    );
    expect(field(decideWith(request(), { nextId: () => ' ' }))).toBe('seatId');
    const blankId = decideWith(request([seat()], { attemptId: ' ' }));
    expect(refusal(blankId)).toEqual({
      code: 'booking.commit.invariant_violated',
      violations: [{ code: 'scheduling.id.empty', idType: 'AppointmentId' }],
    });
  });

  it('refuses a booking whose start has already passed', () => {
    const result = decideWith(
      request(),
      { nowMs: at(12) },
      {
        ...PlacementPolicy.clientDefault(),
        skipMinNotice: true,
      },
    );
    expect(refusal(result)).toEqual({
      code: 'booking.commit.invariant_violated',
      violations: [{ code: 'scheduling.appointment.past_start_time' }],
    });
  });

  it('reports the booker in two chairs at once, and a cart in two currencies', () => {
    const levaBeard = serviceFixture({
      id: ServiceId.of('svc-beard'),
      baseTerms: ServiceTerms.unpadded(1500, 'BGN', 20),
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
          { id: 'id-0', subject: SELF, startMs: at(12), durationMinutes: 30 },
          { id: 'id-1', subject: SELF, startMs: at(12), durationMinutes: 20 },
        ],
      },
      PlacementPolicy.clientDefault(),
      twoChairs,
    );
    expect(refusal(result)).toEqual({
      code: 'booking.commit.invariant_violated',
      violations: [
        { code: 'scheduling.appointment.multiple_self_seats' },
        {
          code: 'scheduling.appointment.mixed_currency',
          expected: 'EUR',
          found: 'BGN',
        },
      ],
    });
  });

  it('builds the refusals the stores raise themselves', () => {
    expect(BookingCommitError.unauthenticated()).toEqual({
      code: 'booking.commit.unauthenticated',
    });
    expect(BookingCommitError.shopUnavailable('loc-x', 'unlisted')).toEqual({
      code: 'booking.commit.invalid_input',
      field: 'locationId',
      detail: 'loc-x',
      reason: 'unlisted',
    });
  });
});
