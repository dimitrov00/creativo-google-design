import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingPolicy,
  BookingCart,
  type CartLine,
  type CartSeatLines,
  Daypart,
  DayWindows,
  FlexibleWhen,
  MinuteRange,
  NotificationTopic,
  RosterWindow,
  type ServiceTerms,
  type ShopNow,
  WaitlistLifecycle,
  WriteAction,
  type WaitlistCall,
} from '@core/components';
import {
  WaitlistStatus,
  BarberId,
  CartLineId,
  LocationId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import { SchedulingErrorCode, WaitlistErrorCode } from '@core/errors';
import type { WaitlistRequest } from '@core/entities';
import {
  deepFreeze,
  endMinute,
  FIXTURE_TIME_ZONE,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  minuteCount,
  termsFixture,
} from '@core/testing';
import { AvailabilitySystem } from './availability.system';
import type { CartBarberDay, CartService } from './booking-cart.system';
import { type WaitlistDoor, WaitlistSystem } from './waitlist.system';
import { ZonedTimeSystem } from './zoned-time.system';

const ZONE = FIXTURE_TIME_ZONE;
const OWNER = 'user-waiting';
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');

/** 2030-01-13 (now, 08:00 — Sofia winter, +02:00) through the watched Tuesday 2030-01-15. */
const TODAY = localDate('2030-01-13');
const DAY = localDate('2030-01-15');
const NOW: ShopNow = ZonedTimeSystem.shopNow(
  utcMs('2030-01-13T08:00:00+02:00'),
  ZONE,
);
const NOW_UTC_MS = NOW.utcEpochMs;
const POLICY = BookingPolicy.DEFAULT;

const hhmm = (clock: string): number => {
  const [hours, minutes] = clock.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};
/** A minute of the day → `HH:MM`. */
const wallClock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const window = (from: string, to: string): MinuteRange =>
  MinuteRange.of(minute(hhmm(from)), endMinute(hhmm(to)));

/** One seat per entry, keyed as the web cart keys them. */
function cartOf(
  seats: readonly (readonly {
    readonly serviceId: string;
    readonly variantId?: string | null;
    readonly barberId?: string | null;
  }[])[],
): BookingCart {
  let sequence = 0;
  return {
    cartSeats: seats.map((lines, index): CartSeatLines => {
      const seatKey = SeatKeyText.of(index === 0 ? 'self' : `guest-${index}`);
      return {
        seatKey,
        lines: lines.map((line): CartLine => ({
          lineId: CartLineId.of(`line-${sequence++}`),
          seatKey,
          serviceId: ServiceId.of(line.serviceId),
          variantId:
            line.variantId === undefined || line.variantId === null
              ? null
              : ServiceVariantId.of(line.variantId),
          barberId:
            line.barberId === undefined || line.barberId === null
              ? null
              : BarberId.of(line.barberId),
          locationId: null,
        })),
      };
    }),
    cartNextSequence: sequence,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * Copied (not moved) from apps/functions/src/use-cases/decide-waitlist.spec.ts
 * — 17 of its 18 cases, re-targeted from `decideWaitlist(request, deps)` to
 * `WaitlistSystem.decide(ask, door)`: the commit's admission and the shop
 * rule arrive as the door's precomputed verdicts (`admission`,
 * `shopListed`), so each case asserts the door surfaces the commit's own
 * refusal, in the commit's order. The commit-side halves (`commitAnswer`,
 * the `CommitBookingUseCase` door, and the one case that runs only
 * `decideBooking`) belong to the booking-decision system and stay in the
 * legacy spec.
 * ═════════════════════════════════════════════════════════════════════ */

function ask(
  seats: Parameters<typeof cartOf>[0],
  locationId: string | null = CENTER,
): WaitlistCall.Input {
  return {
    locationId,
    days: [{ localDate: DAY, windows: [window('10:00', '12:00')] }],
    cart: cartOf(seats),
  };
}

function door(overrides: Partial<WaitlistDoor> = {}): WaitlistDoor {
  return {
    ownerUserId: UserId.of(OWNER),
    now: NOW,
    horizonEndLocalDate: BookingPolicy.horizonEndFrom(POLICY, TODAY),
    maxFlexibleDays: POLICY.maxFlexibleDays,
    // The named shop, as the callable reads it: there, and listed.
    shopListed: true,
    admission: null,
    ...overrides,
  };
}

/** The refusal's field, as the client receives it — or `'accepted'`. */
function answer(
  request: WaitlistCall.Input,
  overrides: Partial<WaitlistDoor> = {},
) {
  const decided = WaitlistSystem.decide(request, door(overrides));
  if (decided.ok) return 'accepted';
  expect(decided.error.errorCode).toBe(WaitlistErrorCode.InvalidRequest);
  return decided.error.errorCode === WaitlistErrorCode.InvalidRequest
    ? decided.error.field
    : decided.error.errorCode;
}

const refusedBy = (errorCode: string) => ({ admission: { errorCode } });

describe('WaitlistSystem.decide — refuses now what the commit refuses at every time', () => {
  it('accepts a party the commit would admit', () => {
    expect(
      answer(ask([[{ serviceId: 'svc-cut' }], [{ serviceId: 'svc-royal' }]])),
    ).toBe('accepted');
  });

  it('refuses more people than the policy seats', () => {
    const three = ask([
      [{ serviceId: 'svc-cut' }],
      [{ serviceId: 'svc-cut' }],
      [{ serviceId: 'svc-cut' }],
    ]);
    expect(answer(three, refusedBy('BOOKING_PARTY_TOO_LARGE'))).toBe(
      'BOOKING_PARTY_TOO_LARGE',
    );
  });

  it('refuses a service the catalogue does not offer — unknown or retired', () => {
    const retired = ask([[{ serviceId: 'svc-retired' }]]);
    expect(answer(retired, refusedBy('BOOKING_UNKNOWN_SERVICE'))).toBe(
      'BOOKING_UNKNOWN_SERVICE',
    );
  });

  it('refuses a service with variants and none chosen, or one it does not declare', () => {
    const none = ask([[{ serviceId: 'svc-color' }]]);
    const undeclared = ask([[{ serviceId: 'svc-color', variantId: 'medium' }]]);
    const chosen = ask([[{ serviceId: 'svc-color', variantId: 'long' }]]);

    expect(answer(none, refusedBy('BOOKING_INVALID_INPUT'))).toBe(
      'BOOKING_INVALID_INPUT',
    );
    expect(answer(undeclared, refusedBy('BOOKING_INVALID_INPUT'))).toBe(
      'BOOKING_INVALID_INPUT',
    );
    expect(answer(chosen)).toBe('accepted');
  });

  it('refuses two services one person may not have together — and allows them for two people', () => {
    const onePerson = ask([
      [{ serviceId: 'svc-beard' }, { serviceId: 'svc-shave' }],
    ]);
    const twoPeople = ask([
      [{ serviceId: 'svc-beard' }],
      [{ serviceId: 'svc-shave' }],
    ]);
    expect(answer(onePerson, refusedBy('BOOKING_CONFLICTING_SERVICES'))).toBe(
      'BOOKING_CONFLICTING_SERVICES',
    );
    expect(answer(twoPeople)).toBe('accepted');
  });

  it('refuses a service the named shop does not offer — and watches any shop for it', () => {
    const atMladost = ask([[{ serviceId: 'svc-royal' }]], MLADOST);
    expect(
      answer(atMladost, refusedBy('BOOKING_SERVICE_NOT_AT_LOCATION')),
    ).toBe('BOOKING_SERVICE_NOT_AT_LOCATION');
    expect(answer(ask([[{ serviceId: 'svc-royal' }]], null))).toBe('accepted');
  });

  it('refuses a cart line that does not read, rather than watching for the rest of the party', () => {
    const broken = ask([[{ serviceId: 'svc-cut' }], [{ serviceId: '' }]]);
    expect(answer(broken)).toBe('cart');
    // A corrupt line counter reads no better than a broken line.
    const fine = ask([[{ serviceId: 'svc-cut' }]]);
    expect(
      answer({ ...fine, cart: { ...fine.cart, cartNextSequence: -1 } }),
    ).toBe('cart');
  });

  it('asks who is waiting before anything about the cart', () => {
    const decided = WaitlistSystem.decide(
      ask([[{ serviceId: 'svc-retired' }]]),
      door({
        ownerUserId: null,
        ...refusedBy('BOOKING_UNKNOWN_SERVICE'),
      }),
    );
    expect(!decided.ok && decided.error.errorCode).toBe(
      WaitlistErrorCode.Unauthenticated,
    );
  });
});

describe('WaitlistSystem.decide — the shop it names, as the commit reads it', () => {
  const cut = [[{ serviceId: 'svc-cut' }]];

  it('refuses a shop the commit would not find, as the stable field `locationId`', () => {
    const error = unwrapErr(
      WaitlistSystem.decide(ask(cut), door({ shopListed: false })),
    );
    expect(error).toEqual({
      errorCode: WaitlistErrorCode.InvalidRequest,
      field: 'locationId',
    });
  });

  it('refuses a shop the public surface no longer lists', () => {
    expect(answer(ask(cut), { shopListed: false })).toBe('locationId');
  });

  it('accepts a listed shop', () => {
    expect(answer(ask(cut), { shopListed: true })).toBe('accepted');
  });

  it('never asks about a shop for an any-shop request — nothing was read', () => {
    expect(answer(ask(cut, null), { shopListed: false })).toBe('accepted');
  });

  it('asks about the shop before the party, in the commit’s order', () => {
    expect(
      answer(ask([[{ serviceId: 'svc-retired' }]]), {
        shopListed: false,
        ...refusedBy('BOOKING_UNKNOWN_SERVICE'),
      }),
    ).toBe('locationId');
  });

  it.each([
    ['an empty id', '', false],
    ['a blank id', '   ', false],
    ['a shop the commit would not find', 'loc-nowhere', false],
    ['a shop the public surface no longer lists', CENTER, false],
  ] as const)(
    'refuses %s as the one field `locationId`',
    (_label, id, listed) => {
      const decided = WaitlistSystem.decide(
        ask(cut, id),
        door({ shopListed: listed }),
      );
      expect(!decided.ok && decided.error).toEqual({
        errorCode: WaitlistErrorCode.InvalidRequest,
        field: 'locationId',
      });
    },
  );

  it('refuses an empty id whatever shop it is handed — the spelling alone names none', () => {
    expect(answer(ask(cut, ''), { shopListed: true })).toBe('locationId');
  });

  it.each([
    ['an empty id', ''],
    ['a blank id', '   '],
  ])(
    'answers %s as the commit’s door answers it — the one field',
    (_label, id) => {
      const waited = WaitlistSystem.decide(
        ask(cut, id),
        door({ shopListed: false }),
      );
      expect(!waited.ok && waited.error).toEqual({
        errorCode: WaitlistErrorCode.InvalidRequest,
        field: 'locationId',
      });
    },
  );

  it('asks about the shop before the days it watches', () => {
    const badDay: WaitlistCall.Input = {
      ...ask(cut, ''),
      days: [{ localDate: 'not-a-day', windows: [window('10:00', '12:00')] }],
    };
    expect(answer(badDay, { shopListed: false })).toBe('locationId');
  });
});

describe('WaitlistSystem.decide — the days and the bag it stores', () => {
  it('drops past days and days past the horizon, refuses a day that is no day, and caps the rest', () => {
    const days = (raws: readonly string[]): WaitlistCall.Input => ({
      ...ask([[{ serviceId: 'svc-cut' }]]),
      days: raws.map((raw) => ({ localDate: raw, windows: [] })),
    });
    const body = unwrapOk(
      WaitlistSystem.decide(days(['2030-01-12', DAY, '2031-01-01']), door()),
    );
    expect(body.localDates).toEqual([DAY]);
    expect(answer(days(['2030-02-30']))).toBe('localDate');
    const eight = Array.from(
      { length: 8 },
      (_, i) => `2030-01-${String(15 + i).padStart(2, '0')}`,
    );
    expect(unwrapErr(WaitlistSystem.decide(days(eight), door()))).toEqual({
      errorCode: WaitlistErrorCode.TooManyDays,
      max: 7,
    });
    expect(answer(days(['2030-01-12']))).toBe(
      SchedulingErrorCode.WaitlistNoDays,
    );
  });

  it('refuses a window that is no span, an empty bag, and stores the rest normalized', () => {
    const backwards: WaitlistCall.Input = {
      ...ask([[{ serviceId: 'svc-cut' }]]),
      // Foreign input: a span the window rule refuses, as it arrives.
      days: [
        { localDate: DAY, windows: [{ startMinutes: 720, endMinutes: 600 }] },
      ],
    };
    expect(answer(backwards)).toBe('windows');
    expect(answer({ ...ask([]), cart: BookingCart.empty() })).toBe(
      SchedulingErrorCode.WaitlistEmptyCart,
    );
    const body = unwrapOk(
      WaitlistSystem.decide(
        {
          ...ask([[{ serviceId: 'svc-cut' }]]),
          days: [
            {
              localDate: DAY,
              windows: [window('11:00', '12:00'), window('10:00', '11:00')],
            },
          ],
        },
        door(),
      ),
    );
    expect(body.flexibleDays).toEqual(
      FlexibleWhen.of([DayWindows.of(DAY, [window('10:00', '12:00')])])
        .flexibleDays,
    );
    expect({
      waitlistStatus: body.waitlistStatus,
      waitlistStatusAtUtcMs: body.waitlistStatusAtUtcMs,
    }).toEqual(WaitlistLifecycle.open(NOW_UTC_MS));
    expect(body.ownerUserId).toBe(OWNER);
    expect(body.createdAtUtcMs).toBe(NOW_UTC_MS);
    // The zone is the location's: the body stores none (Law 7.2).
    expect(body).not.toHaveProperty('zone');
  });
});

describe('WaitlistSystem.idBasis — a request is named by what it means', () => {
  it('collapses two phrasings of one ask to one basis, and tells different asks apart', () => {
    const phrased = (windows: readonly MinuteRange[]): WaitlistCall.Input => ({
      ...ask([[{ serviceId: 'svc-cut' }]]),
      days: [
        { localDate: DAY, windows },
        { localDate: '2030-01-14', windows: [] },
      ],
    });
    const a = unwrapOk(
      WaitlistSystem.decide(
        phrased([window('10:00', '11:00'), window('11:00', '12:00')]),
        door(),
      ),
    );
    const b = unwrapOk(
      WaitlistSystem.decide(phrased([window('10:00', '12:00')]), door()),
    );
    expect(WaitlistSystem.idBasis(a)).toBe(WaitlistSystem.idBasis(b));
    const elsewhere = unwrapOk(
      WaitlistSystem.decide(
        { ...phrased([window('10:00', '12:00')]), locationId: MLADOST },
        door(),
      ),
    );
    expect(WaitlistSystem.idBasis(elsewhere)).not.toBe(
      WaitlistSystem.idBasis(a),
    );
  });
});

describe('WaitlistSystem.idBasis — the stored ids do not move', () => {
  // The basis the P0 callable hashed (`request-waitlist.ts`
  // `deterministicRequestId`): `JSON.stringify({ owner, locationId, when,
  // cart })` over the request's LEGACY props — windows as `'HH:mm'` faces,
  // lines as `{ id, serviceId, variantId, barberId }`. Every request stored
  // before the migration is named by it; a different string would give a
  // re-sent ask a new `wl_` id, slip past the duplicate refusal and notify
  // twice.
  it('is byte for byte the legacy wire basis', () => {
    const body = unwrapOk(
      WaitlistSystem.decide(
        {
          locationId: CENTER,
          days: [
            {
              localDate: DAY,
              windows: [window('09:05', '11:00'), window('10:30', '12:00')],
            },
            { localDate: '2030-01-14', windows: [] },
          ],
          cart: cartOf([
            [{ serviceId: 'svc-cut', barberId: 'ivan' }],
            [{ serviceId: 'svc-beard', variantId: 'long' }],
          ]),
        },
        door(),
      ),
    );
    expect(WaitlistSystem.idBasis(body)).toBe(
      JSON.stringify({
        owner: 'user-waiting',
        locationId: 'loc-center',
        when: {
          days: [
            { dayKey: '2030-01-14', windows: [] },
            {
              dayKey: '2030-01-15',
              windows: [{ from: '09:05', to: '12:00' }],
            },
          ],
        },
        cart: {
          seats: [
            {
              seatKey: 'self',
              lines: [
                {
                  id: 'line-0',
                  serviceId: 'svc-cut',
                  variantId: null,
                  barberId: 'ivan',
                },
              ],
            },
            {
              seatKey: 'guest-1',
              lines: [
                {
                  id: 'line-1',
                  serviceId: 'svc-beard',
                  variantId: 'long',
                  barberId: null,
                },
              ],
            },
          ],
          nextSequence: 2,
        },
      }),
    );
    expect(WaitlistSystem.idBasis(body)).toBe(
      '{"owner":"user-waiting","locationId":"loc-center","when":{"days":[{"dayKey":"2030-01-14","windows":[]},{"dayKey":"2030-01-15","windows":[{"from":"09:05","to":"12:00"}]}]},"cart":{"seats":[{"seatKey":"self","lines":[{"id":"line-0","serviceId":"svc-cut","variantId":null,"barberId":"ivan"}]},{"seatKey":"guest-1","lines":[{"id":"line-1","serviceId":"svc-beard","variantId":"long","barberId":null}]}],"nextSequence":2}}',
    );
  });
});

describe('WaitlistSystem.withinReadBounds — a crafted cart costs the shop no reads', () => {
  // Copied from apps/functions/src/lib/booking/request-waitlist.spec.ts
  // ('draws the bound at the cap and at the per-person service count').
  it('draws the bound at the cap and at the per-person service count', () => {
    const cap = POLICY.maxPartySize;
    const withLines = (count: number): BookingCart =>
      cartOf([
        Array.from({ length: count }, (_, index) => ({
          serviceId: `svc-${index}`,
        })),
      ]);
    expect(
      WaitlistSystem.withinReadBounds(
        withLines(WaitlistSystem.MAX_SERVICES_PER_PERSON * cap),
        cap,
      ),
    ).toBe(true);
    expect(
      WaitlistSystem.withinReadBounds(
        withLines(WaitlistSystem.MAX_SERVICES_PER_PERSON * cap + 1),
        cap,
      ),
    ).toBe(false);
    expect(
      WaitlistSystem.withinReadBounds(
        cartOf(
          Array.from({ length: cap + 1 }, () => [{ serviceId: 'svc-cut' }]),
        ),
        cap,
      ),
    ).toBe(false);
  });
});

describe('WaitlistSystem.hasLapsed / cooldownSinceUtcMs', () => {
  // Copied from the legacy scheduling `waitlist-request.spec.ts` (expiry;
  // deleted in Phase 4b).
  const when = FlexibleWhen.of([
    DayWindows.wholeDay(localDate('2026-08-25')),
    DayWindows.of(localDate('2026-08-26'), [window('08:00', '12:00')]),
  ]);

  it('lapses once every day it named is behind us', () => {
    expect(FlexibleWhen.lastLocalDate(when)).toBe('2026-08-26');
    expect(WaitlistSystem.hasLapsed(when, localDate('2026-08-26'))).toBe(false);
    expect(WaitlistSystem.hasLapsed(when, localDate('2026-08-27'))).toBe(true);
  });

  it('is still live on the last day itself', () => {
    expect(WaitlistSystem.hasLapsed(when, localDate('2026-08-25'))).toBe(false);
    expect(
      WaitlistSystem.hasLapsed(FlexibleWhen.empty(), localDate('2026-08-25')),
    ).toBe(false);
  });

  it('suppresses a second notification for six hours of elapsed time', () => {
    expect(WaitlistSystem.cooldownSinceUtcMs(NOW_UTC_MS)).toBe(
      NOW_UTC_MS - 6 * 3_600_000,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Copied (not moved) from apps/functions/src/use-cases/match-waitlist.spec.ts
 * — all 18 cases, re-targeted from the Firestore-backed end-to-end path to
 * `WaitlistSystem.match` over the snapshot `loadDayAvailability` reads: the
 * barbers' windows at LISTED shops (a hidden shop holds none), busy padded
 * by their turnaround, the active catalogue rows. The commit-side halves
 * (`commit(...)`) belong to the booking-decision system; the closing
 * property keeps the promise's checkable half — the match names the asked
 * shop and barbers, places the whole party, inside the declared windows,
 * after the lead floor, at free rostered time.
 * ═════════════════════════════════════════════════════════════════════ */

interface Segment {
  readonly start: string;
  readonly end: string;
  readonly locationId: LocationId;
}
interface BarberSeed {
  readonly id: string;
  readonly segments: readonly Segment[];
  readonly turnaroundMinutes?: number;
  readonly busy?: readonly (readonly [string, string])[];
}

const works = (locationId: LocationId, start = '09:00', end = '18:00') => [
  { start, end, locationId },
];

function service(
  id: string,
  terms: ServiceTerms,
  locationIds: readonly LocationId[],
): CartService {
  return { id: ServiceId.of(id), ...terms, offerings: [], locationIds };
}

/** The active catalogue: a cut everywhere, a royal shave at Center, a beard at Mladost. */
const CATALOGUE: readonly CartService[] = [
  service('svc-cut', termsFixture(2500, 30), []),
  service('svc-royal', termsFixture(2500, 45, 0, 10), [CENTER]),
  service('svc-beard', termsFixture(2500, 20, 5, 0), [MLADOST]),
];

/** The day as `loadDayAvailability` reads it; a hidden shop holds no windows. */
function snapshot(
  barbers: readonly BarberSeed[],
  hidden: readonly LocationId[] = [],
): readonly CartBarberDay[] {
  const out: CartBarberDay[] = [];
  for (const seed of barbers) {
    const id = BarberId.of(seed.id);
    const windows = seed.segments
      .filter((segment) => !hidden.includes(segment.locationId))
      .map((segment) =>
        RosterWindow.of(
          id,
          segment.locationId,
          minute(hhmm(segment.start)),
          endMinute(hhmm(segment.end)),
        ),
      );
    if (windows.length === 0) continue;
    out.push({
      barberId: id,
      windows,
      busy: AvailabilitySystem.paddedBusy({
        barberId: id,
        spans: (seed.busy ?? []).map(([from, to]) => window(from, to)),
        turnaroundMinutes: minuteCount(seed.turnaroundMinutes ?? 0),
        release: [],
      }),
    });
  }
  return out;
}

interface Ask {
  readonly locationId: LocationId | null;
  readonly seats: readonly {
    readonly seatKey: string;
    readonly serviceId: string;
    readonly barberId?: string | null;
  }[];
  readonly windows: readonly { readonly from: string; readonly to: string }[];
}

function requestFor(wanted: Ask): WaitlistRequest {
  const cart = cartOf(
    wanted.seats.map((entry) => [
      { serviceId: entry.serviceId, barberId: entry.barberId ?? null },
    ]),
  );
  const when = FlexibleWhen.of([
    DayWindows.of(
      DAY,
      wanted.windows.map((w) => window(w.from, w.to)),
    ),
  ]);
  return {
    id: WaitlistRequestId.of('wl-1'),
    ownerUserId: UserId.of(OWNER),
    locationId: wanted.locationId,
    localDates: FlexibleWhen.localDates(when),
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, ZONE),
    createdAtUtcMs: NOW_UTC_MS,
    ...cart,
    ...when,
    ...WaitlistLifecycle.open(NOW_UTC_MS),
  };
}

function matchIn(
  barbers: readonly CartBarberDay[],
  request: WaitlistRequest,
  options: {
    readonly now?: ShopNow;
    readonly policy?: BookingPolicy;
    readonly admissible?: boolean;
    readonly services?: readonly CartService[];
  } = {},
) {
  return WaitlistSystem.match(
    request,
    DAY,
    { services: options.services ?? CATALOGUE, barbers },
    {
      now: options.now ?? NOW,
      policy: options.policy ?? POLICY,
      admissible: options.admissible ?? true,
    },
  );
}

function promised(barbers: readonly CartBarberDay[], request: WaitlistRequest) {
  const found = matchIn(barbers, request);
  if (found === null) return null;
  return {
    at: wallClock(found.startMinutes),
    locationId: found.locationId,
    barbers: found.barberIds,
  };
}

describe('WaitlistSystem.match — a notification the booking path keeps', () => {
  it('sends a start the commit accepts, at the shop the request named', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '10:30']] },
    ]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '12:00' }],
    });
    expect(promised(day, request)).toEqual({
      at: '10:30',
      locationId: CENTER,
      barbers: ['ivan'],
    });
  });

  it('sends nothing at a shop that does not offer the service', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '12:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-royal' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(matchIn(day, request)).toBeNull();
  });

  it('still sends it once the shop that offers it frees up', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '10:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-royal' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(promised(day, request)).toEqual({
      at: '10:00',
      locationId: CENTER,
      barbers: ['ivan'],
    });
  });

  it('sends nothing at a shop the request did not name', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '12:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const atCenter = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(matchIn(day, atCenter)).toBeNull();
  });

  it('sends the other shop’s time when the request named that shop, or none', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '12:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    for (const locationId of [MLADOST, null]) {
      const request = requestFor({
        locationId,
        seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
        windows: [{ from: '10:00', to: '11:00' }],
      });
      expect(promised(day, request)).toEqual({
        at: '10:00',
        locationId: MLADOST,
        barbers: ['niko'],
      });
    }
  });

  it('sends nothing that splits a party across two shops', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [
        { seatKey: 'self', serviceId: 'svc-cut' },
        { seatKey: 'guest-1', serviceId: 'svc-cut' },
      ],
      windows: [{ from: '10:00', to: '10:30' }],
    });
    expect(matchIn(day, request)).toBeNull();
  });

  it('sends the party side by side at one shop with two free chairs', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'niko', segments: works(MLADOST) },
      { id: 'petar', segments: works(CENTER) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [
        { seatKey: 'self', serviceId: 'svc-cut' },
        { seatKey: 'guest-1', serviceId: 'svc-cut' },
      ],
      windows: [{ from: '10:00', to: '10:30' }],
    });
    const sent = promised(day, request);
    expect(sent).toMatchObject({ at: '10:00', locationId: CENTER });
    expect([...(sent?.barbers ?? [])].sort()).toEqual(['ivan', 'petar']);
  });

  it('sends nothing inside the barber’s turnaround', () => {
    const day = snapshot([
      {
        id: 'ivan',
        segments: works(CENTER),
        turnaroundMinutes: 15,
        busy: [['10:00', '11:00']],
      },
    ]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '11:00', to: '11:30' }],
    });
    expect(matchIn(day, request)).toBeNull();
  });

  it('sends the first start after the turnaround', () => {
    const day = snapshot([
      {
        id: 'ivan',
        segments: works(CENTER),
        turnaroundMinutes: 15,
        busy: [['10:00', '11:00']],
      },
    ]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '11:00', to: '12:00' }],
    });
    expect(promised(day, request)).toEqual({
      at: '11:15',
      locationId: CENTER,
      barbers: ['ivan'],
    });
  });

  it('keeps to the barber the request asked for', () => {
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut', barberId: 'niko' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    const nikoBusy = snapshot([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'niko', segments: works(MLADOST), busy: [['09:00', '12:00']] },
    ]);
    expect(matchIn(nikoBusy, request)).toBeNull();

    const nikoFree = snapshot([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    expect(promised(nikoFree, request)).toEqual({
      at: '10:00',
      locationId: MLADOST,
      barbers: ['niko'],
    });
  });

  it('sends nothing for part of a party whose other service left the catalog', () => {
    const day = snapshot([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [
        { seatKey: 'self', serviceId: 'svc-cut' },
        { seatKey: 'guest-1', serviceId: 'svc-retired' },
      ],
      windows: [{ from: '10:00', to: '12:00' }],
    });
    // The commit's admission refuses the party (`unknown_service`)…
    expect(matchIn(day, request, { admissible: false })).toBeNull();
    // …which is why it is asked: the grid alone drops the retired line and
    // would place the cut by itself — a visit nobody asked for.
    const partial = matchIn(day, request);
    expect(partial?.assignments.map((a) => a.lineId)).toEqual(['line-0']);
  });

  it('sends nothing past the booking horizon', () => {
    // Two months ahead of 1 October is 1 December: the 15th of January is
    // not bookable yet, whatever the chairs say.
    const day = snapshot([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    const autumn = ZonedTimeSystem.shopNow(
      utcMs('2029-10-01T08:00:00+03:00'),
      ZONE,
    );
    expect(matchIn(day, request, { now: autumn })).toBeNull();
  });
});

describe('WaitlistSystem.match — sends nothing the catalogue no longer lets the commit keep', () => {
  it('sends nothing once a service the request names gained variants', () => {
    const day = snapshot([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(matchIn(day, request)).not.toBeNull();
    // The line chose no variant, and the commit now needs one.
    expect(matchIn(day, request, { admissible: false })).toBeNull();
  });

  it('sends nothing once two services one person asked for conflict', () => {
    const day = snapshot([{ id: 'ivan', segments: works(CENTER) }]);
    // ONE person, two services, one after the other.
    const base = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '12:00' }],
    });
    const request: WaitlistRequest = {
      ...base,
      ...cartOf([[{ serviceId: 'svc-cut' }, { serviceId: 'svc-royal' }]]),
    };
    expect(matchIn(day, request)).not.toBeNull();
    expect(matchIn(day, request, { admissible: false })).toBeNull();
  });

  it('sends nothing to a party over a cap the owner lowered', () => {
    const day = snapshot([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'petar', segments: works(CENTER) },
    ]);
    const request = requestFor({
      locationId: CENTER,
      seats: [
        { seatKey: 'self', serviceId: 'svc-cut' },
        { seatKey: 'guest-1', serviceId: 'svc-cut' },
      ],
      windows: [{ from: '10:00', to: '10:30' }],
    });
    expect(matchIn(day, request)).not.toBeNull();
    const lowered = unwrapOk(
      BookingPolicy.create({ ...POLICY, maxPartySize: 1 }),
    );
    expect(
      matchIn(day, request, { policy: lowered, admissible: false }),
    ).toBeNull();
  });
});

describe('WaitlistSystem.match — searches only the shops `/book` lists', () => {
  it('skips a request whose shop was hidden since — and matches it again once the shop is back', () => {
    const seeds: readonly BarberSeed[] = [
      { id: 'ivan', segments: works(CENTER) },
    ];
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(matchIn(snapshot(seeds), request)).not.toBeNull();
    expect(matchIn(snapshot(seeds, [CENTER]), request)).toBeNull();
    expect(promised(snapshot(seeds), request)).toEqual({
      at: '10:00',
      locationId: CENTER,
      barbers: ['ivan'],
    });
  });

  it('never tells an any-shop request of a slot at a hidden shop', () => {
    const seeds: readonly BarberSeed[] = [
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '18:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ];
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(matchIn(snapshot(seeds), request)?.locationId).toBe(MLADOST);
    expect(matchIn(snapshot(seeds, [MLADOST]), request)).toBeNull();
  });
});

describe('WaitlistSystem.match — every match is a promise the grid keeps', () => {
  const BARBERS = ['ivan', 'niko', 'petar'] as const;
  const SHOPS = [null, CENTER, MLADOST] as const;
  const SERVICES = ['svc-cut', 'svc-royal', 'svc-beard'] as const;

  /** Minutes after 09:00 → `HH:MM`. */
  const clock = (minutes: number): string => {
    const total = 9 * 60 + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const roster = fc.constantFrom<readonly Segment[]>(
    works(CENTER),
    works(MLADOST),
    [
      { start: '09:00', end: '13:00', locationId: CENTER },
      { start: '13:00', end: '18:00', locationId: MLADOST },
    ],
    [],
  );

  const busy = fc.array(
    fc
      .record({
        from: fc.integer({ min: 0, max: 107 }).map((step) => step * 5),
        length: fc.integer({ min: 2, max: 18 }).map((step) => step * 5),
      })
      .map(
        ({ from, length }) =>
          [clock(from), clock(Math.min(from + length, 540))] as const,
      ),
    { maxLength: 3 },
  );

  const world = fc.tuple(
    ...BARBERS.map((id) =>
      fc.record({
        id: fc.constant(id),
        segments: roster,
        turnaroundMinutes: fc.constantFrom(0, 5, 10, 15),
        busy,
      }),
    ),
  );

  const wanted = fc.record({
    locationId: fc.constantFrom(...SHOPS),
    seats: fc
      .array(
        fc.record({
          serviceId: fc.constantFrom(...SERVICES),
          barberId: fc.constantFrom<string | null>(null, ...BARBERS),
        }),
        { minLength: 1, maxLength: 2 },
      )
      .map((lines) =>
        lines.map((entry, index) => ({
          ...entry,
          seatKey: index === 0 ? 'self' : `guest-${index}`,
        })),
      ),
    windows: fc
      .record({
        from: fc.integer({ min: 0, max: 32 }).map((step) => step * 15),
        length: fc.integer({ min: 2, max: 16 }).map((step) => step * 15),
      })
      .map(({ from, length }) => [
        { from: clock(from), to: clock(Math.min(from + length, 600)) },
      ]),
  });

  it('holds over random rosters, turnarounds, busy days and requests', () => {
    let sent = 0;
    fc.assert(
      fc.property(world, wanted, (seeds, asked) => {
        const day = snapshot(seeds);
        const request = requestFor(asked);
        const found = matchIn(day, request);
        if (found === null) return;
        sent++;

        if (asked.locationId !== null) {
          expect(found.locationId).toBe(asked.locationId);
        }
        // The WHOLE party is placed — a line left out is a visit nobody asked for.
        const lines = request.cartSeats.flatMap((seat) => seat.lines);
        expect(found.assignments.map((a) => a.lineId).sort()).toEqual(
          lines.map((l) => l.lineId).sort(),
        );
        const declared = asked.windows[0] as { from: string; to: string };
        for (const assignment of found.assignments) {
          const line = lines.find((l) => l.lineId === assignment.lineId);
          // A SPECIFIC barber the request asked for is the barber the match names.
          if (line?.barberId) expect(assignment.barberId).toBe(line.barberId);
          // Inside the declared window, after the lead floor.
          expect(assignment.startMinutes).toBeGreaterThanOrEqual(
            hhmm(declared.from),
          );
          expect(assignment.endMinutes).toBeLessThanOrEqual(hhmm(declared.to));
          const floor = AvailabilitySystem.leadFloor(NOW, POLICY, DAY);
          expect(floor).not.toBeNull();
          expect(assignment.startMinutes).toBeGreaterThanOrEqual(floor ?? 0);
          // At the shop's own rostered time, never on the barber's busy time.
          const barberDay = day.find((b) => b.barberId === assignment.barberId);
          expect(
            barberDay?.windows.some(
              (w) =>
                w.locationId === found.locationId &&
                w.startMinutes <= assignment.startMinutes &&
                assignment.endMinutes <= w.endMinutes,
            ),
          ).toBe(true);
          for (const taken of barberDay?.busy ?? []) {
            expect(MinuteRange.overlaps(taken, assignment)).toBe(false);
          }
        }
      }),
      { numRuns: 250 },
    );
    // Not vacuous: plenty of the random days did send something.
    expect(sent).toBeGreaterThan(15);
  });
});

describe('WaitlistSystem.planMatch — one plan, notification and lifecycle together', () => {
  const request = requestFor({
    locationId: CENTER,
    seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
    windows: [{ from: '10:00', to: '12:00' }],
  });
  const found = matchIn(
    snapshot([{ id: 'ivan', segments: works(CENTER) }]),
    request,
  );

  it('writes the notification FACTS under the owner and moves the request to MATCHED', () => {
    if (found === null) throw new Error('bad fixture');
    const plan = unwrapOk(
      WaitlistSystem.planMatch(request, found, NOW, () => 'n-1'),
    );
    expect(plan.waitlist).toEqual({
      waitlistStatus: WaitlistStatus.Matched,
      waitlistStatusAtUtcMs: NOW_UTC_MS,
    });
    // The freed start on the shop's clock — no zone, no instant to word.
    expect(plan.notification).toEqual({
      id: 'n-1',
      sentAtUtcMs: NOW_UTC_MS,
      readAtUtcMs: null,
      notificationTopic: NotificationTopic.WaitlistMatch,
      waitlistRequestId: 'wl-1',
      localDate: DAY,
      startMinutes: found.startMinutes,
    });
    expect(plan.writes.map((op) => [op.writeAction, op.path])).toEqual([
      [WriteAction.Create, ['users', OWNER, 'notifications', 'n-1']],
      [WriteAction.Update, ['waitlistRequests', 'wl-1']],
    ]);
    // The transition writes root fields only (Law 5).
    const update = plan.writes[1];
    expect(update?.writeAction === WriteAction.Update && update.fields).toEqual(
      {
        waitlistStatus: WaitlistStatus.Matched,
        waitlistStatusAtUtcMs: NOW_UTC_MS,
      },
    );
    // No words: the inbox words the facts in the reader's locale.
    expect(JSON.stringify(plan)).not.toMatch(/Освободи|"title"|"deepLink"/);
  });

  it('tells a terminal request nothing', () => {
    if (found === null) throw new Error('bad fixture');
    const booked: WaitlistRequest = {
      ...request,
      waitlistStatus: WaitlistStatus.Booked,
      waitlistStatusAtUtcMs: NOW_UTC_MS,
    };
    const error = unwrapErr(
      WaitlistSystem.planMatch(booked, found, NOW, () => 'n-1'),
    );
    expect(error.errorCode).toBe(SchedulingErrorCode.WaitlistInvalidTransition);
  });
});

describe('WaitlistSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const request = deepFreeze(
      requestFor({
        locationId: null,
        seats: [
          { seatKey: 'self', serviceId: 'svc-cut' },
          { seatKey: 'guest-1', serviceId: 'svc-cut' },
        ],
        windows: [{ from: '10:00', to: '12:00' }],
      }),
    );
    const day = deepFreeze(
      snapshot([
        { id: 'ivan', segments: works(CENTER), busy: [['09:00', '10:00']] },
        { id: 'petar', segments: works(CENTER) },
      ]),
    );
    const before = JSON.stringify([request, day]);
    const once = matchIn(day, request);
    expect(matchIn(day, request)).toEqual(once);
    expect(once).not.toBeNull();
    const asked = deepFreeze(ask([[{ serviceId: 'svc-cut' }]]));
    expect(WaitlistSystem.decide(asked, door())).toEqual(
      WaitlistSystem.decide(asked, door()),
    );
    expect(JSON.stringify([request, day])).toBe(before);
  });
});

/*
 * Law 10.2 decision extraction (W0-A): the waiting request's rules the
 * presenters held — `visit-row.presenter.ts` `waitlistRowOf` (the days still
 * watched, the parts of the day they touch, where the row files) and
 * `glance.presenter.ts` `visitCardsVm` (which request the glance shows).
 * Each case re-states the pinning presenter case as a value/tag assertion.
 */

describe('WaitlistSystem.daysAhead — the days a request still watches', () => {
  const ROW_TODAY = localDate('2026-09-28');
  const days = (raw: readonly string[]) =>
    raw.map((key) => DayWindows.wholeDay(localDate(key)));
  const keys = (watched: readonly DayWindows[]) =>
    watched.map((day) => day.localDate);

  it('keeps every day ahead (row 1115)', () => {
    expect(
      keys(
        WaitlistSystem.daysAhead(days(['2026-10-01', '2026-10-02']), ROW_TODAY),
      ),
    ).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('drops the days that have passed, keeping today itself (row 1149)', () => {
    const watched = days([
      '2026-09-20',
      '2026-10-01',
      '2026-10-12',
      '2026-10-14',
      '2026-10-20',
      '2026-10-22',
    ]);
    expect(keys(WaitlistSystem.daysAhead(watched, ROW_TODAY))).toEqual([
      '2026-10-01',
      '2026-10-12',
      '2026-10-14',
      '2026-10-20',
      '2026-10-22',
    ]);
    expect(
      keys(
        WaitlistSystem.daysAhead(days(['2026-09-27', '2026-09-28']), ROW_TODAY),
      ),
    ).toEqual(['2026-09-28']);
  });

  it('keeps every day it named when none is ahead, and when there is no today to read (card 576)', () => {
    const passed = days(['2026-09-20', '2026-09-21']);
    expect(WaitlistSystem.daysAhead(passed, ROW_TODAY)).toBe(passed);
    const mixed = days(['2026-09-20', '2026-10-01']);
    // An unparsable today reaches the system as `null`: every day stays.
    expect(WaitlistSystem.daysAhead(mixed, null)).toBe(mixed);
    expect(WaitlistSystem.daysAhead([], ROW_TODAY)).toEqual([]);
  });
});

describe('WaitlistSystem.daypartsWatched — the parts of the day the windows touch', () => {
  const AFTERNOON = [window('13:00', '17:00')];

  it('names the one part a run of afternoons touches (row 1115)', () => {
    expect(
      WaitlistSystem.daypartsWatched([
        DayWindows.of(localDate('2026-10-01'), AFTERNOON),
        DayWindows.of(localDate('2026-10-02'), AFTERNOON),
      ]),
    ).toEqual([Daypart.Afternoon]);
  });

  it('names every part a window touches, in the day’s order (row 1211)', () => {
    expect(
      WaitlistSystem.daypartsWatched([
        DayWindows.of(localDate('2026-10-01'), [window('11:00', '13:00')]),
      ]),
    ).toEqual(['MORNING', 'AFTERNOON']);
    expect(
      WaitlistSystem.daypartsWatched([
        DayWindows.of(localDate('2026-10-02'), [window('18:00', '20:00')]),
        DayWindows.of(localDate('2026-10-01'), [window('09:00', '10:00')]),
      ]),
    ).toEqual(['MORNING', 'EVENING']);
  });

  it('names none when ANY day is offered whole, every day whole, or no day at all (row 1149, 1211)', () => {
    expect(
      WaitlistSystem.daypartsWatched([
        DayWindows.of(localDate('2026-10-01'), AFTERNOON),
        DayWindows.wholeDay(localDate('2026-10-02')),
      ]),
    ).toEqual([]);
    expect(
      WaitlistSystem.daypartsWatched([
        DayWindows.wholeDay(localDate('2026-10-01')),
        DayWindows.wholeDay(localDate('2026-10-12')),
      ]),
    ).toEqual([]);
    expect(WaitlistSystem.daypartsWatched([])).toEqual([]);
  });
});

describe('WaitlistSystem.sortPoint — where a waiting request files', () => {
  it('files at its first watched day, from the day’s first minute (row 1115, 1149)', () => {
    expect(
      WaitlistSystem.sortPoint([
        DayWindows.of(localDate('2026-10-01'), [window('13:00', '17:00')]),
        DayWindows.wholeDay(localDate('2026-10-02')),
      ]),
    ).toEqual({ localDate: '2026-10-01', minute: 0 });
  });

  it('files a request that watches no day at the first day of the civil axis, minute 0 (row 1255)', () => {
    expect(WaitlistSystem.sortPoint([])).toEqual({
      localDate: '1970-01-01',
      minute: 0,
    });
  });
});

describe('WaitlistSystem.glancePick — the glance’s waiting request', () => {
  const base = requestFor({
    locationId: null,
    seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
    windows: [{ from: '13:00', to: '17:00' }],
  });
  const hour = (hours: number): UtcEpochMs =>
    UtcEpochMs.plusHours(NOW_UTC_MS, hours);
  const made = (id: string, createdAtUtcMs: UtcEpochMs): WaitlistRequest => ({
    ...base,
    id: WaitlistRequestId.of(id),
    createdAtUtcMs,
  });
  const ids = (pick: { readonly newest: WaitlistRequest | null }) =>
    pick.newest === null ? null : pick.newest.id;

  it('shows the request still waiting, and no others (glance 960)', () => {
    expect(WaitlistSystem.glancePick([base], [], TODAY, false)).toEqual({
      newest: base,
      others: 0,
    });
  });

  it('shows the NEWEST request and counts the others (glance 989)', () => {
    const older = made('wl-older', hour(-24 * 8));
    const pick = WaitlistSystem.glancePick([older, base], [], TODAY, false);
    expect(ids(pick)).toBe('wl-1');
    expect(pick.others).toBe(1);
    // Equal stamps keep the input's order: the first one in is the newest.
    const twin = made('wl-twin', NOW_UTC_MS);
    expect(ids(WaitlistSystem.glancePick([twin, base], [], TODAY, false))).toBe(
      'wl-twin',
    );
    expect(ids(WaitlistSystem.glancePick([base, twin], [], TODAY, false))).toBe(
      'wl-1',
    );
  });

  it('shows none while the client is paused (glance 1001)', () => {
    expect(WaitlistSystem.glancePick([base], [], TODAY, true)).toEqual({
      newest: null,
      others: 0,
    });
  });

  it('shows none once the request stopped watching, but still a matched one (glance 1001)', () => {
    const booked: WaitlistRequest = {
      ...base,
      waitlistStatus: WaitlistStatus.Booked,
      waitlistStatusAtUtcMs: NOW_UTC_MS,
    };
    expect(WaitlistSystem.glancePick([booked], [], TODAY, false).newest).toBe(
      null,
    );
    const matched: WaitlistRequest = {
      ...base,
      waitlistStatus: WaitlistStatus.Matched,
      waitlistStatusAtUtcMs: NOW_UTC_MS,
    };
    expect(ids(WaitlistSystem.glancePick([matched], [], TODAY, false))).toBe(
      'wl-1',
    );
  });

  it('shows none once every day it named has passed, but still on the last day itself (glance 1001)', () => {
    expect(
      WaitlistSystem.glancePick([base], [], localDate('2030-01-16'), false)
        .newest,
    ).toBe(null);
    expect(ids(WaitlistSystem.glancePick([base], [], DAY, false))).toBe('wl-1');
  });

  it('shows none once a visit to come was booked at or after it — a stamp-order rule (glance 1001)', () => {
    const at = (bookedAtUtcMs: UtcEpochMs | null) => [{ bookedAtUtcMs }];
    expect(
      WaitlistSystem.glancePick([base], at(hour(1)), TODAY, false).newest,
    ).toBe(null);
    // The same instant answers it too (≥).
    expect(
      WaitlistSystem.glancePick([base], at(NOW_UTC_MS), TODAY, false).newest,
    ).toBe(null);
    // Booked before the request was made: the request still waits.
    expect(
      ids(WaitlistSystem.glancePick([base], at(hour(-1)), TODAY, false)),
    ).toBe('wl-1');
    // A visit written before the stamp existed answers nothing.
    expect(ids(WaitlistSystem.glancePick([base], at(null), TODAY, false))).toBe(
      'wl-1',
    );
    // Only the requests it answers drop out: one made after the visit was
    // booked still waits, and is the only one left.
    const newer = made('wl-newer', hour(2));
    const pick = WaitlistSystem.glancePick(
      [base, newer],
      at(hour(1)),
      TODAY,
      false,
    );
    expect(ids(pick)).toBe('wl-newer');
    expect(pick.others).toBe(0);
  });

  it('shows none for no request', () => {
    expect(WaitlistSystem.glancePick([], [], TODAY, false)).toEqual({
      newest: null,
      others: 0,
    });
  });
});

describe('WaitlistSystem — the extraction, purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const days = deepFreeze([
      DayWindows.of(localDate('2030-01-12'), [window('09:00', '10:00')]),
      DayWindows.of(localDate('2030-01-15'), [window('13:00', '17:00')]),
    ]);
    expect(WaitlistSystem.daysAhead(days, TODAY)).toEqual(
      WaitlistSystem.daysAhead(days, TODAY),
    );
    expect(WaitlistSystem.daypartsWatched(days)).toEqual(
      WaitlistSystem.daypartsWatched(days),
    );
    expect(WaitlistSystem.sortPoint(days)).toEqual(
      WaitlistSystem.sortPoint(days),
    );
    const requests = deepFreeze([
      requestFor({
        locationId: null,
        seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
        windows: [{ from: '13:00', to: '17:00' }],
      }),
    ]);
    const upcoming = deepFreeze([{ bookedAtUtcMs: null }]);
    const before = JSON.stringify([days, requests, upcoming]);
    expect(WaitlistSystem.glancePick(requests, upcoming, TODAY, false)).toEqual(
      WaitlistSystem.glancePick(requests, upcoming, TODAY, false),
    );
    expect(JSON.stringify([days, requests, upcoming])).toBe(before);
  });
});
