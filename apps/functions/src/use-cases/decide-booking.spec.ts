import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { BarberId, Service } from '@creativo/domain/catalog';
import {
  BookingPolicy,
  CalendarDay,
  Interval,
  StaffScheduleHistory,
  WeeklyPattern,
} from '@creativo/domain/scheduling';
import { exceptionFromDocument } from '@creativo/application/booking';
import {
  type BookingSnapshot,
  type DecideBookingRequest,
  type LoadedSchedule,
  type RequestedSeat,
  decideBooking,
} from './decide-booking';
import {
  CommitBookingDuplicateGuestLabelError,
  CommitBookingPersonDoubleBookedError,
} from './decide-booking.errors';

const ZONE = 'Europe/Sofia';
const OWNER = 'user-1';

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
/** Mon..Sun — open every day but Sunday. */
const SHOP_HOURS = [
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  CLOSED,
];

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
  return unwrap(
    Service.create({
      id: 'svc-fade',
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 4000,
      currencyCode: 'EUR',
      durationMinutes: 60,
      locationIds: overrides.locationIds ?? ['loc-center'],
      conflictsWith: overrides.conflictsWith ?? [],
      variants: overrides.variants ?? [],
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 4500,
            currencyCode: 'EUR',
            durationMinutes: 30,
            cleanupMinutes: 10,
          },
        },
      ],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

function beardService(conflictsWith: readonly string[] = []): Service {
  return unwrap(
    Service.create({
      id: 'svc-beard',
      name: { bg: 'Брада', en: 'Beard' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 1500,
      currencyCode: 'EUR',
      durationMinutes: 20,
      locationIds: ['loc-center'],
      conflictsWith,
      variants: [],
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 1500,
            currencyCode: 'EUR',
            durationMinutes: 20,
          },
        },
      ],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 2,
    }),
  );
}

function schedule(
  options: {
    readonly locationId?: string;
    readonly turnaroundMinutes?: number;
  } = {},
): LoadedSchedule {
  const at = options.locationId ?? 'loc-center';
  const day = [{ start: '09:00', end: '18:00', locationId: at }];
  const pattern = unwrap(
    WeeklyPattern.create({ byWeekday: { monday: day, tuesday: day } }),
  );
  return {
    history: StaffScheduleHistory.startingWith(
      pattern,
      unwrap(CalendarDay.create('2026-01-01', ZONE)),
    ),
    turnaroundMinutes: options.turnaroundMinutes ?? 0,
  };
}

function snapshot(overrides: Partial<BookingSnapshot> = {}): BookingSnapshot {
  return {
    zone: ZONE,
    shopHours: SHOP_HOURS,
    services: [fadeService(), beardService()],
    schedules: new Map([['ivan', schedule()]]),
    busy: new Map(),
    exceptions: new Map(),
    ...overrides,
  };
}

function seat(overrides: Partial<RequestedSeat> = {}): RequestedSeat {
  return {
    lineId: 'line-1',
    serviceId: 'svc-fade',
    variantId: null,
    barberId: 'ivan',
    startIso: at(12).toISO(),
    subject: { kind: 'self' },
    ...overrides,
  };
}

function request(
  seats: readonly RequestedSeat[] = [seat()],
  overrides: Partial<DecideBookingRequest> = {},
): DecideBookingRequest {
  return { locationId: 'loc-center', seats, ...overrides };
}

const POLICY = BookingPolicy.default();

function deps(now: ZonedDateTime = at(8)) {
  let counter = 0;
  return {
    now,
    policy: POLICY,
    nextId: () => `id-${counter++}`,
    ownerUserId: OWNER,
  };
}

describe('decideBooking — terms come from the catalog, never the client', () => {
  it('prices the seat from `termsFor(barber, variant)`', () => {
    // The request carries no price at all. Ivan's offering says 45,00 € / 30
    // min with 10 minutes of cleanup — the catalog's numbers, not the
    // service's 40,00 € / 60 min base.
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const [committed] = decision.appointment.seats;

    expect(committed?.terms.price.toMinorUnits()).toBe(4500);
    expect(committed?.terms.durationMinutes).toBe(30);
    expect(committed?.terms.cleanupMinutes).toBe(10);
  });

  it('binds the self seat to the AUTH uid, not to anything in the payload', () => {
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    const subject = decision.appointment.seats[0]?.subject;

    expect(subject?.kind).toBe('account');
    if (subject?.kind === 'account') {
      expect(subject.userId.value).toBe(OWNER);
    }
  });

  it('claims the chair for setup + service + cleanup, but sells only the service', () => {
    // The client is charged for 30 minutes; the barber is blocked for 40.
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));

    expect(decision.appointment.seats[0]?.durationMinutes()).toBe(30);
    expect(
      Interval.durationMinutes(decision.busyWrites[0]?.interval as Interval),
    ).toBe(40);
  });

  it('ALLOWS a service with no declared locations — empty means everywhere', () => {
    // The catalog's own convention (`Service.servesLocation`). Reading empty
    // as "nowhere" refused every service the shop never bothered to scope,
    // which is most of them.
    const result = decideBooking(
      request(),
      snapshot({ services: [fadeService({ locationIds: [] })] }),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('refuses a service the shop does not offer at this location', () => {
    const result = decideBooking(
      request(),
      snapshot({ services: [fadeService({ locationIds: ['loc-mladost'] })] }),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.service_not_at_location');
    }
  });

  it('refuses a service that is not in the snapshot at all', () => {
    // An inactive or malformed service document never reaches the snapshot,
    // so "unknown" covers "withdrawn from the catalog since the tab loaded".
    const result = decideBooking(request(), snapshot({ services: [] }), deps());
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.unknown_service');
    }
  });
});

describe('decideBooking — availability is re-checked, not trusted', () => {
  it('refuses a slot that overlaps an existing booking', () => {
    const busy = new Map([
      ['ivan__2026-08-03', [Interval.of(at(12).toMillis(), at(13).toMillis())]],
    ]);
    const result = decideBooking(request(), snapshot({ busy }), deps());

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.slot_unavailable');
    }
  });

  it('allows a booking that ABUTS an existing one when turnaround is zero', () => {
    // Half-open intervals: [11:00,12:00) and [12:00,12:40) do not overlap.
    const busy = new Map([
      ['ivan__2026-08-03', [Interval.of(at(11).toMillis(), at(12).toMillis())]],
    ]);
    expect(
      decideBooking(request(), snapshot({ busy }), deps()).isSuccess(),
    ).toBe(true);
  });

  it('refuses the same abutting booking once the barber has a turnaround', () => {
    // 15 minutes of reset pads the existing block on both sides, so 12:00 is
    // inside it. This is the one place turnaround is applied.
    const busy = new Map([
      ['ivan__2026-08-03', [Interval.of(at(11).toMillis(), at(12).toMillis())]],
    ]);
    const result = decideBooking(
      request(),
      snapshot({
        busy,
        schedules: new Map([['ivan', schedule({ turnaroundMinutes: 15 })]]),
      }),
      deps(),
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.slot_unavailable');
    }
  });

  describe('a rebuilt visit’s own chairs (`BookingSnapshot.release`)', () => {
    // Stored: the visit being moved (10:00–11:00) merged with a neighbour
    // (11:00–12:00), and a 15-minute reset. Ivan's fade holds the chair 40
    // minutes (30 + 10 of cleanup).
    const ownChair = Interval.of(at(10).toMillis(), at(11).toMillis());
    const moved = (release: BookingSnapshot['release']) =>
      snapshot({
        busy: new Map([
          [
            'ivan__2026-08-03',
            [Interval.of(at(10).toMillis(), at(12).toMillis())],
          ],
        ]),
        schedules: new Map([['ivan', schedule({ turnaroundMinutes: 15 })]]),
        release,
      });
    const startingAt = (hour: number, minute = 0) =>
      request([seat({ startIso: at(hour, minute).toISO() })]);

    it('never lets them block where the visit goes next', () => {
      const own = [
        { barberId: unwrap(BarberId.create('ivan')), occupied: ownChair },
      ];

      expect(
        decideBooking(startingAt(10), moved(undefined), deps()).isFailure(),
      ).toBe(true);
      expect(
        decideBooking(startingAt(10), moved(own), deps()).isSuccess(),
      ).toBe(true);
    });

    it('hands them back BEFORE padding, so the neighbour keeps its reset', () => {
      // 10:15–10:55 ends inside the neighbour's reset (10:45–11:00). Released
      // after padding, that reset would have been freed with the visit.
      const own = [
        { barberId: unwrap(BarberId.create('ivan')), occupied: ownChair },
      ];
      const result = decideBooking(startingAt(10, 15), moved(own), deps());

      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error.code).toBe('booking.commit.slot_unavailable');
      }
    });

    it('frees nothing of another barber’s', () => {
      const theirs = [
        { barberId: unwrap(BarberId.create('niko')), occupied: ownChair },
      ];
      expect(
        decideBooking(startingAt(10), moved(theirs), deps()).isFailure(),
      ).toBe(true);
    });
  });

  it('refuses a time outside the barber’s rostered window', () => {
    // Rostered 09:00–18:00; 18:30 is not a window even though the shop is open.
    const result = decideBooking(
      request([seat({ startIso: at(18, 30).toISO() })]),
      snapshot(),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.slot_unavailable');
    }
  });

  it('refuses a barber with no roster document', () => {
    const result = decideBooking(
      request(),
      snapshot({ schedules: new Map() }),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.barber_not_rostered');
    }
  });

  it('refuses a day a published exception has closed, roster notwithstanding', () => {
    const exception = exceptionFromDocument({
      barberId: 'ivan',
      dayKey: '2026-08-03',
      zone: ZONE,
      locationId: 'loc-center',
      effect: { kind: 'closed' },
    });
    expect(exception).not.toBeNull();
    if (!exception) return;

    const result = decideBooking(
      request(),
      snapshot({
        exceptions: new Map([['ivan__2026-08-03', exception]]),
      }),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      // The roster says Ivan works; the exception says not today. The day
      // leaves the sellable set entirely, same refusal as no roster at all.
      expect(result.error.code).toBe('booking.commit.barber_not_rostered');
    }
  });

  it('clamps to the SHOP’s hours, not just the roster', () => {
    // The barber is rostered 09:00–18:00, but the shop publishes 09:00–13:00
    // that day. 14:00 is rostered and shut.
    const shortDay = [
      { kind: 'open' as const, opens: '09:00', closes: '13:00' },
      ...SHOP_HOURS.slice(1),
    ];
    const result = decideBooking(
      request([seat({ startIso: at(14).toISO() })]),
      snapshot({ shopHours: shortDay }),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
  });
});

describe('decideBooking — policy and party rules', () => {
  it('refuses a booking inside the minimum lead time', () => {
    // Now is 11:00, the default lead is 120 minutes, the seat is at 12:00.
    const result = decideBooking(request(), snapshot(), deps(at(11)));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.too_soon');
    }
  });

  it('refuses a party larger than the policy allows', () => {
    const seats = Array.from({ length: POLICY.maxPartySize + 1 }, (_, index) =>
      seat({
        lineId: `line-${index}`,
        subject: { kind: 'guest', label: `Guest ${index}` },
      }),
    );
    const result = decideBooking(request(seats), snapshot(), deps());
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.party_too_large');
    }
  });

  it('refuses two conflicting services for ONE person', () => {
    // The UI locks this; a UI is not an enforcement boundary.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
        }),
      ]),
      snapshot({
        services: [
          fadeService({ conflictsWith: ['svc-beard'] }),
          beardService(['svc-fade']),
        ],
      }),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.conflicting_services');
    }
  });

  it('ALLOWS two conflicting services for one person when the shop is booking — a staff edit or placement', () => {
    // Owner, 2026-09-17: "a staff account could do whatever he wants". The
    // `conflictsWith` rule is the client's self-booking rule; the shop's own
    // book skips it, like the window, with no second tap.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
        }),
      ]),
      snapshot({
        services: [
          fadeService({ conflictsWith: ['svc-beard'] }),
          beardService(['svc-fade']),
        ],
      }),
      { ...deps(), allowConflictingServices: true },
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.appointment.seats.length).toBe(2);
    }
  });

  it('ALLOWS the same conflicting pair across two different people', () => {
    // Conflicts are scoped to a person: a couple can have one each.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
          subject: { kind: 'guest', label: 'Maria' },
        }),
      ]),
      snapshot({
        services: [
          fadeService({ conflictsWith: ['svc-beard'] }),
          beardService(['svc-fade']),
        ],
      }),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('refuses a variant the service does not declare', () => {
    const result = decideBooking(
      request([seat({ variantId: 'forged' })]),
      snapshot(),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.invalid_input');
    }
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
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.invalid_input');
    }
  });

  it('refuses a party whose own seats double-book one barber', () => {
    // Caught by the Appointment aggregate, not by a check here.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          subject: { kind: 'guest', label: 'Maria' },
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.commit.invariant_violated');
    }
  });

  it('accepts a party served back-to-back by ONE barber', () => {
    // Ivan: fade 12:00–12:30 with 10 min cleanup, then the beard at 12:40.
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(12, 40).toISO(),
          subject: { kind: 'guest', label: 'Maria' },
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });
});

describe('decideBooking — the contact rides along as a snapshot', () => {
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
    expect(decision.appointment.contact?.phone.value).toBe('+359896330113');
    expect(decision.appointment.contact?.email?.value).toBe('emil@example.com');
    expect(decision.appointment.contact?.note).toBe('закъснявам 5 минути');
  });

  it('commits with no contact at all — an older client still books', () => {
    const decision = unwrap(decideBooking(request(), snapshot(), deps()));
    expect(decision.appointment.contact).toBeNull();
  });

  it('REFUSES a contact the shop could not act on', () => {
    // An unreachable number is caught here, before an appointment exists —
    // not discovered when the shop tries to call.
    const result = decideBooking(
      request([seat()], { contact: { ...CONTACT, phone: '12' } }),
      snapshot(),
      deps(),
    );

    expect(result.isFailure()).toBe(true);
    if (result.isSuccess()) return;
    expect(result.error.code).toBe('booking.commit.invalid_input');
  });
});

/*
 * STAFF PLACEMENT (owner ruling 2026-08-07 #3, built 2026-09-08). The shop
 * placing its own book: nobody has to own it, the clock and the roster do
 * not gate it, and it is confirmed the moment it is made.
 */
describe('decideBooking — the shop places its own book', () => {
  it('books a walk-in nobody owns, as guest seats, confirmed', () => {
    const decision = unwrap(
      decideBooking(
        request([
          seat({ subject: { kind: 'guest', label: 'Случаен клиент' } }),
        ]),
        snapshot(),
        { ...deps(), ownerUserId: null, allowOutsideWindow: true },
      ),
    );
    expect(decision.appointment.status.kind).toBe('confirmed');
    expect(decision.appointment.seats[0]?.subject.kind).toBe('anonymous');
  });

  it('places a booking that has already started — the walk-in is in the chair', () => {
    // `now` is past the seat's start; a client booking would be refused.
    const decision = decideBooking(
      request([seat({ subject: { kind: 'guest', label: 'Случаен клиент' } })]),
      snapshot(),
      { ...deps(at(12, 10)), ownerUserId: null, allowOutsideWindow: true },
    );
    expect(decision.isSuccess()).toBe(true);
  });

  it('keeps a carried companion on their OWN account, never the owner’s', () => {
    const decision = unwrap(
      decideBooking(
        request([
          seat(),
          seat({
            lineId: 'line-2',
            startIso: at(13).toISO(),
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
    expect(booker?.kind === 'account' && booker.userId.value).toBe(OWNER);
    expect(
      companion?.kind === 'account' && [
        companion.userId.value,
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
    expect(decision.isFailure() && decision.error.code).toBe(
      'booking.commit.invalid_input',
    );
  });

  it('still refuses a self seat with nobody to bind it to', () => {
    const decision = decideBooking(request(), snapshot(), {
      ...deps(),
      ownerUserId: null,
      allowOutsideWindow: true,
    });
    expect(decision.isSuccess()).toBe(false);
  });

  it('confirms a booking placed on behalf of a client', () => {
    const decision = unwrap(
      decideBooking(request(), snapshot(), {
        ...deps(),
        ownerUserId: 'client-7',
        allowOutsideWindow: true,
      }),
    );
    expect(decision.appointment.status.kind).toBe('confirmed');
    const subject = decision.appointment.seats[0]?.subject;
    expect(subject?.kind === 'account' && subject.userId.value).toBe(
      'client-7',
    );
  });
});

/*
 * §11.2 #6: the preference is what somebody asked for, never a default. An
 * omitted one used to be stored as `specific`, so a «Всеки» the payload lost,
 * a phone booking into the free chair and a staff drag of a legacy seat all
 * read as a request for whoever did the cut.
 */
describe('decideBooking — the barber preference is recorded, never guessed', () => {
  const prefOf = (requested: Partial<RequestedSeat>) =>
    unwrap(decideBooking(request([seat(requested)]), snapshot(), deps()))
      .appointment.seats[0]?.pref ?? null;

  it('stores «Всеки» as any and a named barber as specific', () => {
    expect(prefOf({ barberPref: 'any' })?.kind).toBe('any');
    expect(prefOf({ barberPref: 'specific' })?.kind).toBe('specific');
  });

  it('stores an omitted preference as unknown, not as a request', () => {
    expect(prefOf({})).toBeNull();
  });
});

/*
 * ── ONE PERSON, ONE CHAIR AT A TIME (owner decision, 2026-09-25) ─────────
 * The grid keeps one person out of two chairs (`AvailabilityLine.personKey`);
 * the decision refuses a cart that asks for it anyway, on every path.
 */
describe('decideBooking — one person is never in two chairs at once', () => {
  /** Ivan and Petar both work the day; Petar is on the catalogue's base terms. */
  const twoChairs = () =>
    snapshot({
      schedules: new Map([
        ['ivan', schedule()],
        ['petar', schedule()],
      ]),
    });

  const refusal = (result: ReturnType<typeof decideBooking>) =>
    result.isFailure() ? result.error : null;

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
    expect(error).toBeInstanceOf(CommitBookingPersonDoubleBookedError);
    expect(error?.code).toBe('booking.commit.invalid_input');
    // The reason rides on the wire as the field — never the person's key,
    // which can name somebody else's account.
    expect(error?.params).toEqual({ field: 'person_overlap' });
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
          startIso: at(12, 30).toISO(),
        }),
      ]),
      twoChairs(),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('still seats two different people side by side', () => {
    const result = decideBooking(
      request([
        seat(),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: { kind: 'guest', label: 'Maria' },
        }),
      ]),
      twoChairs(),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('reads one label as one guest — two of its seats may not overlap either', () => {
    const maria = { kind: 'guest', label: 'Maria' } as const;
    const result = decideBooking(
      request([
        seat({ subject: maria }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          startIso: at(12, 15).toISO(),
          subject: { kind: 'guest', label: ' Maria ' },
        }),
      ]),
      twoChairs(),
      deps(),
    );
    expect(refusal(result)).toBeInstanceOf(
      CommitBookingPersonDoubleBookedError,
    );
  });

  it('holds on the shop’s own paths too — no acknowledgement seats a person twice', () => {
    const result = decideBooking(
      request([
        seat({ subject: { kind: 'guest', label: 'Случаен клиент' } }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: { kind: 'guest', label: 'Случаен клиент' },
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
    expect(refusal(result)).toBeInstanceOf(
      CommitBookingPersonDoubleBookedError,
    );
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
              startIso: at(12)
                .plusMinutes(draft.quarter * 15)
                .toISO(),
              subject:
                draft.person === 'self'
                  ? { kind: 'self' }
                  : { kind: 'guest', label: draft.person },
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
            snapshot({
              schedules: new Map(BARBERS.map((id) => [id, schedule()])),
            }),
            deps(),
          );
          if (twice) {
            expect(refusal(result)).toBeInstanceOf(
              CommitBookingPersonDoubleBookedError,
            );
          } else {
            expect(result.isSuccess()).toBe(true);
          }
        },
      ),
    );
  });
});

/*
 * ── A PAIR THE VISIT ALREADY HELD ────────────────────────────────────────
 * A rebuild (a staff edit, a client's move) names the visit as it stands.
 * Only a NEW overlap is refused (owner decision, round 5): a pair of seats
 * that already seated one person twice is identified by SEAT ID and may
 * keep overlapping wherever the edit puts it; a pair that did not overlap,
 * or a seat the edit adds, is judged in full.
 *
 * The pairs are GUESTS (and companions in the property): the booker's own
 * double seating never reaches a store, because the aggregate refuses it
 * (`AppointmentMultipleSelfSeatsError`). Two walk-ins under the staff
 * sheet's old shared label are the real case: one person to the server.
 *
 * `deps().nextId` mints `id-0`, `id-1`, … in request order, which is how a
 * rebuild re-mints its stored seat ids — so a standing seat `id-N` IS the
 * request's seat N.
 */
describe('decideBooking — a double seating the visit already held stands', () => {
  const chairs = () =>
    snapshot({
      schedules: new Map([
        ['ivan', schedule()],
        ['petar', schedule()],
        ['georgi', schedule()],
      ]),
    });
  const refusal = (result: ReturnType<typeof decideBooking>) =>
    result.isFailure() ? result.error : null;

  const walkIn = { kind: 'guest', label: 'Случаен клиент' } as const;
  /** A 30-minute fade with Ivan beside a 20-minute beard with Petar, one label. */
  const heldPair = [
    {
      id: 'id-0',
      subject: walkIn,
      startMs: at(12).toMillis(),
      durationMinutes: 30,
    },
    {
      id: 'id-1',
      subject: walkIn,
      startMs: at(12).toMillis(),
      durationMinutes: 20,
    },
  ] as const;
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
  const held = () => ({ ...deps(), standing: heldPair });

  it('carries the pair while the edit leaves both seats where they stood', () => {
    // A discount, a tip, somebody else's seat: nothing about the pair moves.
    const result = decideBooking(request([fade(), beard()]), chairs(), held());
    expect(result.isSuccess()).toBe(true);
  });

  it('refuses the same pair from a write that does not name it as history', () => {
    expect(
      refusal(decideBooking(request([fade(), beard()]), chairs(), deps())),
    ).toBeInstanceOf(CommitBookingPersonDoubleBookedError);
  });

  // The round-3 regression: the grandfather matched on the exact chair,
  // start and minutes, so moving the pair TOGETHER — which leaves the visit
  // no worse — was refused with "pick another time", and no time worked.
  it('lets the whole visit be dragged, the pair moving together', () => {
    const result = decideBooking(
      request([
        fade({ startIso: at(14).toISO() }),
        beard({ startIso: at(14).toISO() }),
      ]),
      chairs(),
      held(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('lets one seat of the pair move, stretch or change chair and still overlap', () => {
    for (const edited of [
      beard({ startIso: at(12, 5).toISO() }),
      beard({ barberId: 'georgi' }),
    ]) {
      expect(
        decideBooking(request([fade(), edited]), chairs(), held()).isSuccess(),
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
      ).toBeInstanceOf(CommitBookingPersonDoubleBookedError);
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
          startIso: at(12, 10).toISO(),
          subject: walkIn,
        }),
      ]),
      chairs(),
      held(),
    );
    expect(refusal(result)).toBeInstanceOf(
      CommitBookingPersonDoubleBookedError,
    );
  });

  it('knows the pair by seat IDENTITY — the same seats under other ids are new', () => {
    const result = decideBooking(request([fade(), beard()]), chairs(), {
      ...deps(),
      standing: heldPair.map((stood, index) => ({
        ...stood,
        id: `seat-${index}`,
      })),
    });
    expect(refusal(result)).toBeInstanceOf(
      CommitBookingPersonDoubleBookedError,
    );
  });

  it('lets a separating move through: the pair no longer overlaps', () => {
    const result = decideBooking(
      request([fade(), beard({ startIso: at(12, 30).toISO() })]),
      chairs(),
      held(),
    );
    expect(result.isSuccess()).toBe(true);
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
          // A whole-visit drag moves every seat by the first one's shift.
          const shiftOf = (index: number) =>
            wholeVisit ? (drafts[0]?.shift ?? 0) : (drafts[index]?.shift ?? 0);
          const subjectOf = (person: string): RequestedSeat['subject'] =>
            person === 'companion'
              ? { kind: 'companion', userId: 'user-2' }
              : { kind: 'guest', label: person };
          const startOf = (quarter: number) => at(12).plusMinutes(quarter * 15);
          // The visit as it stood: every seat on its own barber, so only
          // the PERSON can collide.
          const standing = drafts.map((draft, index) => ({
            id: `id-${index}`,
            subject: subjectOf(draft.person),
            startMs: startOf(draft.quarter).toMillis(),
            durationMinutes: MINUTES[draft.serviceId],
          }));
          const seats = drafts.map((draft, index) =>
            seat({
              lineId: `line-${index}`,
              serviceId: draft.serviceId,
              barberId: `b${index}`,
              startIso: startOf(draft.quarter + shiftOf(index)).toISO(),
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
            snapshot({
              schedules: new Map(drafts.map((_, i) => [`b${i}`, schedule()])),
            }),
            { ...deps(), standing },
          );
          if (refused) {
            expect(refusal(result)).toBeInstanceOf(
              CommitBookingPersonDoubleBookedError,
            );
          } else {
            // A whole-visit drag always lands here: every overlap after it
            // is one the visit already held.
            expect(result.isSuccess()).toBe(true);
          }
        },
      ),
    );
  });
});

/*
 * ── TWO GUESTS, ONE LABEL ────────────────────────────────────────────────
 * A guest is nothing but their label to the server, so two different guests
 * under one would be merged into one person. The client names its guests
 * (`guestKey`) so the decision can tell them apart and refuse.
 */
describe('decideBooking — two different guests may not share a label', () => {
  const guest = (label: string, guestKey?: string) =>
    ({
      kind: 'guest',
      label,
      ...(guestKey === undefined ? {} : { guestKey }),
    }) as const;

  it('refuses two named guests under one label, wherever they sit', () => {
    const result = decideBooking(
      request([
        seat({ subject: guest('Гост 2', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
          subject: guest('Гост 2', 'guest-4'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(
        CommitBookingDuplicateGuestLabelError,
      );
      expect(result.error.code).toBe('booking.commit.invalid_input');
      expect(result.error.params).toEqual({ field: 'guest_label' });
    }
  });

  it('compares the labels as they will be stored — trimmed', () => {
    const result = decideBooking(
      request([
        seat({ subject: guest('Мария', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
          subject: guest('  Мария ', 'guest-2'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.isFailure() && result.error).toBeInstanceOf(
      CommitBookingDuplicateGuestLabelError,
    );
  });

  it('takes ONE guest with two services — one key, one label', () => {
    const result = decideBooking(
      request([
        seat({ subject: guest('Мария', 'guest-1') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
          subject: guest('Мария', 'guest-1'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  // Round 5: "one label, one guest" had a second, private implementation
  // here beside the domain's `BookingParty.sharedLabel`. The decision now
  // asks the domain's function (whose own spec pins it against the party's
  // report), and this guard keeps a copy from growing back.
  it('asks the domain’s label rule — never a copy of it', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this spec's sibling source, located from its own directory.
    const source = readFileSync(join(__dirname, 'decide-booking.ts'), 'utf8');
    expect(source).toMatch(
      /\blabelSharedByTwoGuests,[^;]*from '@creativo\/domain\/scheduling'/,
    );
    expect(source).not.toMatch(/function labelSharedByTwoGuests\b/);
  });

  it('reads one label as one person when the client names nobody — as it always has', () => {
    const result = decideBooking(
      request([
        seat({ subject: guest('Мария') }),
        seat({
          lineId: 'line-2',
          serviceId: 'svc-beard',
          startIso: at(14).toISO(),
          subject: guest('Мария'),
        }),
      ]),
      snapshot(),
      deps(),
    );
    expect(result.isSuccess()).toBe(true);
  });
});
