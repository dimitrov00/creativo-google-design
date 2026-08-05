import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
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
