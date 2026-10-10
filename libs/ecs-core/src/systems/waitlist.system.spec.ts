import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy } from '../components/booking-policy.data';
import { BookingCart, type CartLine } from '../components/cart-line.data';
import { DayKey } from '../components/day-key.data';
import type { DayOffset } from '../components/day-offset.data';
import { DayWindows } from '../components/day-windows.data';
import { FlexibleWhen } from '../components/flexible-when.data';
import { MinuteRange } from '../components/minute-range.data';
import { NotificationKind } from '../components/notification-payload.data';
import { RosterWindow } from '../components/roster-window.data';
import { SchedulingErrorCode } from '../components/scheduling-errors.data';
import { ServiceTerms } from '../components/service-terms.data';
import { TimeInterval } from '../components/time-interval.data';
import {
  WaitlistState,
  WaitlistStatus,
} from '../components/waitlist-status.data';
import { WriteKind } from '../components/write-op.data';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import {
  type WaitlistRequestEntity,
  WaitlistRequestId,
} from '../entities/waitlist-request.entity';
import { dayTableFixture, deepFreeze, unwrapErr, unwrapOk } from '../testing';
import { AvailabilitySystem } from './availability.system';
import type { CartBarberDay, CartService } from './booking-cart.system';
import { WaitlistErrorCode } from '../components/waitlist-errors.data';
import {
  type WaitlistAsk,
  type WaitlistDoor,
  WaitlistSystem,
} from './waitlist.system';

const ZONE = 'Europe/Sofia';
const OWNER = 'user-waiting';
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');

/** 2030-01-13 (now, 08:00) through the watched Tuesday 2030-01-15. */
const TABLE = dayTableFixture('2030-01-13', '2030-01-15', ZONE);
const TODAY = TABLE[0] as DayOffset;
const DAY = TABLE[2] as DayOffset;
const DAY_KEY = DAY.dayKey;
const NOW_MS = TODAY.dayStartMs + 8 * 3_600_000;
const POLICY = BookingPolicy.DEFAULT;

const hhmm = (clock: string): number => {
  const [hours, minutes] = clock.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};
/** `HH:MM` on the watched day → an instant. */
const at = (clock: string): number => DAY.dayStartMs + hhmm(clock) * 60_000;
const wallClock = (ms: number): string => {
  const minutes = Math.round((ms - DAY.dayStartMs) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const window = (from: string, to: string): MinuteRange =>
  MinuteRange.of(hhmm(from), hhmm(to));

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
    seats: seats.map((lines, index) => {
      const seatKey = index === 0 ? 'self' : `guest-${index}`;
      return {
        seatKey,
        lines: lines.map((line): CartLine => ({
          lineId: `line-${sequence++}`,
          seatKey,
          serviceId: ServiceId.of(line.serviceId),
          variantId: (line.variantId ?? null) as CartLine['variantId'],
          barberId:
            line.barberId === undefined || line.barberId === null
              ? null
              : BarberId.of(line.barberId),
          locationId: null,
        })),
      };
    }),
    nextSequence: sequence,
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
): WaitlistAsk {
  return {
    locationId,
    days: [{ dayKey: DAY_KEY, windows: [window('10:00', '12:00')] }],
    cart: cartOf(seats),
  };
}

function door(overrides: Partial<WaitlistDoor> = {}): WaitlistDoor {
  return {
    ownerUserId: OWNER,
    zone: ZONE,
    nowMs: NOW_MS,
    todayDayKey: TODAY.dayKey,
    horizonEndDayKey: BookingPolicy.horizonEndFrom(POLICY, TODAY.dayKey),
    maxFlexibleDays: POLICY.maxFlexibleDays,
    // The named shop, as the callable reads it: there, and listed.
    shopListed: true,
    admission: null,
    ...overrides,
  };
}

/** The refusal's field, as the client receives it — or `'accepted'`. */
function answer(request: WaitlistAsk, overrides: Partial<WaitlistDoor> = {}) {
  const decided = WaitlistSystem.decide(request, door(overrides));
  if (decided.ok) return 'accepted';
  expect(decided.error.code).toBe(WaitlistErrorCode.InvalidRequest);
  return decided.error.code === WaitlistErrorCode.InvalidRequest
    ? decided.error.field
    : decided.error.code;
}

const refusedBy = (code: string) => ({ admission: { code } });

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
    expect(answer(three, refusedBy('booking.commit.party_too_large'))).toBe(
      'booking.commit.party_too_large',
    );
  });

  it('refuses a service the catalogue does not offer — unknown or retired', () => {
    const retired = ask([[{ serviceId: 'svc-retired' }]]);
    expect(answer(retired, refusedBy('booking.commit.unknown_service'))).toBe(
      'booking.commit.unknown_service',
    );
  });

  it('refuses a service with variants and none chosen, or one it does not declare', () => {
    const none = ask([[{ serviceId: 'svc-color' }]]);
    const undeclared = ask([[{ serviceId: 'svc-color', variantId: 'medium' }]]);
    const chosen = ask([[{ serviceId: 'svc-color', variantId: 'long' }]]);

    expect(answer(none, refusedBy('booking.commit.invalid_input'))).toBe(
      'booking.commit.invalid_input',
    );
    expect(answer(undeclared, refusedBy('booking.commit.invalid_input'))).toBe(
      'booking.commit.invalid_input',
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
    expect(
      answer(onePerson, refusedBy('booking.commit.conflicting_services')),
    ).toBe('booking.commit.conflicting_services');
    expect(answer(twoPeople)).toBe('accepted');
  });

  it('refuses a service the named shop does not offer — and watches any shop for it', () => {
    const atMladost = ask([[{ serviceId: 'svc-royal' }]], MLADOST);
    expect(
      answer(atMladost, refusedBy('booking.commit.service_not_at_location')),
    ).toBe('booking.commit.service_not_at_location');
    expect(answer(ask([[{ serviceId: 'svc-royal' }]], null))).toBe('accepted');
  });

  it('refuses a cart line that does not read, rather than watching for the rest of the party', () => {
    const broken = ask([[{ serviceId: 'svc-cut' }], [{ serviceId: '' }]]);
    expect(answer(broken)).toBe('cart');
    // A corrupt line counter reads no better than a broken line.
    const fine = ask([[{ serviceId: 'svc-cut' }]]);
    expect(answer({ ...fine, cart: { ...fine.cart, nextSequence: -1 } })).toBe(
      'cart',
    );
  });

  it('asks who is waiting before anything about the cart', () => {
    const decided = WaitlistSystem.decide(
      ask([[{ serviceId: 'svc-retired' }]]),
      door({
        ownerUserId: null,
        ...refusedBy('booking.commit.unknown_service'),
      }),
    );
    expect(!decided.ok && decided.error.code).toBe(
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
      code: WaitlistErrorCode.InvalidRequest,
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
        ...refusedBy('booking.commit.unknown_service'),
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
        code: WaitlistErrorCode.InvalidRequest,
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
        code: WaitlistErrorCode.InvalidRequest,
        field: 'locationId',
      });
    },
  );

  it('asks about the shop before the days it watches', () => {
    const badDay: WaitlistAsk = {
      ...ask(cut, ''),
      days: [{ dayKey: 'not-a-day', windows: [window('10:00', '12:00')] }],
    };
    expect(answer(badDay, { shopListed: false })).toBe('locationId');
  });
});

describe('WaitlistSystem.decide — the days and the bag it stores', () => {
  it('drops past days and days past the horizon, refuses a day that is no day, and caps the rest', () => {
    const days = (keys: readonly string[]): WaitlistAsk => ({
      ...ask([[{ serviceId: 'svc-cut' }]]),
      days: keys.map((dayKey) => ({ dayKey, windows: [] })),
    });
    const body = unwrapOk(
      WaitlistSystem.decide(
        days(['2030-01-12', DAY_KEY, '2031-01-01']),
        door(),
      ),
    );
    expect(body.dayKeys).toEqual([DAY_KEY]);
    expect(answer(days(['2030-02-30']))).toBe('dayKey');
    const eight = Array.from(
      { length: 8 },
      (_, i) => `2030-01-${String(15 + i).padStart(2, '0')}`,
    );
    expect(unwrapErr(WaitlistSystem.decide(days(eight), door()))).toEqual({
      code: WaitlistErrorCode.TooManyDays,
      max: 7,
    });
    expect(answer(days(['2030-01-12']))).toBe(
      SchedulingErrorCode.WaitlistNoDays,
    );
  });

  it('refuses a window that is no span, an empty bag, and stores the rest normalized', () => {
    const backwards: WaitlistAsk = {
      ...ask([[{ serviceId: 'svc-cut' }]]),
      days: [{ dayKey: DAY_KEY, windows: [MinuteRange.of(720, 600)] }],
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
              dayKey: DAY_KEY,
              windows: [window('11:00', '12:00'), window('10:00', '11:00')],
            },
          ],
        },
        door(),
      ),
    );
    expect(body.when).toEqual(
      FlexibleWhen.of([DayWindows.of(DAY_KEY, [window('10:00', '12:00')])]),
    );
    expect(body.status).toEqual(WaitlistStatus.open(NOW_MS));
    expect(body.ownerUserId).toBe(OWNER);
    expect(body.createdAtMs).toBe(NOW_MS);
  });
});

describe('WaitlistSystem.idBasis — a request is named by what it means', () => {
  it('collapses two phrasings of one ask to one basis, and tells different asks apart', () => {
    const phrased = (windows: readonly MinuteRange[]): WaitlistAsk => ({
      ...ask([[{ serviceId: 'svc-cut' }]]),
      days: [
        { dayKey: DAY_KEY, windows },
        { dayKey: '2030-01-14', windows: [] },
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
              dayKey: DAY_KEY,
              windows: [window('09:05', '11:00'), window('10:30', '12:00')],
            },
            { dayKey: '2030-01-14', windows: [] },
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

describe('WaitlistSystem.hasLapsed / cooldownSinceMs', () => {
  // Copied from libs/domain/scheduling/src/lib/waitlist-request.spec.ts (expiry).
  const when = FlexibleWhen.of([
    DayWindows.wholeDay(DayKey.of('2026-08-25')),
    DayWindows.of(DayKey.of('2026-08-26'), [window('08:00', '12:00')]),
  ]);

  it('lapses once every day it named is behind us', () => {
    expect(FlexibleWhen.lastDayKey(when)).toBe('2026-08-26');
    expect(WaitlistSystem.hasLapsed(when, DayKey.of('2026-08-26'))).toBe(false);
    expect(WaitlistSystem.hasLapsed(when, DayKey.of('2026-08-27'))).toBe(true);
  });

  it('is still live on the last day itself', () => {
    expect(WaitlistSystem.hasLapsed(when, DayKey.of('2026-08-25'))).toBe(false);
    expect(
      WaitlistSystem.hasLapsed(FlexibleWhen.empty(), DayKey.of('2026-08-25')),
    ).toBe(false);
  });

  it('suppresses a second notification for six hours', () => {
    expect(WaitlistSystem.cooldownSinceMs(NOW_MS)).toBe(NOW_MS - 6 * 3_600_000);
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
  return { id: ServiceId.of(id), baseTerms: terms, offerings: [], locationIds };
}

/** The active catalogue: a cut everywhere, a royal shave at Center, a beard at Mladost. */
const CATALOGUE: readonly CartService[] = [
  service('svc-cut', ServiceTerms.unpadded(2500, 'EUR', 30), []),
  service('svc-royal', ServiceTerms.of(2500, 'EUR', 45, 0, 10), [CENTER]),
  service('svc-beard', ServiceTerms.of(2500, 'EUR', 20, 5, 0), [MLADOST]),
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
          hhmm(segment.start),
          hhmm(segment.end),
        ),
      );
    if (windows.length === 0) continue;
    out.push({
      barberId: id,
      windows,
      busy: AvailabilitySystem.paddedBusy({
        barberId: id,
        spans: (seed.busy ?? []).map(([from, to]) =>
          TimeInterval.of(at(from), at(to)),
        ),
        turnaroundMinutes: seed.turnaroundMinutes ?? 0,
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

function requestFor(wanted: Ask): WaitlistRequestEntity {
  const cart = cartOf(
    wanted.seats.map((entry) => [
      { serviceId: entry.serviceId, barberId: entry.barberId ?? null },
    ]),
  );
  const when = FlexibleWhen.of([
    DayWindows.of(
      DAY_KEY,
      wanted.windows.map((w) => window(w.from, w.to)),
    ),
  ]);
  return {
    id: WaitlistRequestId.of('wl-1'),
    ownerUserId: UserId.of(OWNER),
    locationId: wanted.locationId,
    zone: ZONE,
    cart,
    when,
    dayKeys: FlexibleWhen.dayKeys(when),
    status: WaitlistStatus.open(NOW_MS),
    createdAtMs: NOW_MS,
  };
}

function matchIn(
  barbers: readonly CartBarberDay[],
  request: WaitlistRequestEntity,
  options: {
    readonly nowMs?: number;
    readonly todayDayKey?: DayKey;
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
      nowMs: options.nowMs ?? NOW_MS,
      todayDayKey: options.todayDayKey ?? TODAY.dayKey,
      policy: options.policy ?? POLICY,
      admissible: options.admissible ?? true,
    },
  );
}

function promised(
  barbers: readonly CartBarberDay[],
  request: WaitlistRequestEntity,
) {
  const found = matchIn(barbers, request);
  if (found === null) return null;
  return {
    at: wallClock(found.startMs),
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
    expect(
      matchIn(day, request, { todayDayKey: DayKey.of('2029-10-01') }),
    ).toBeNull();
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
    const request: WaitlistRequestEntity = {
      ...base,
      cart: cartOf([[{ serviceId: 'svc-cut' }, { serviceId: 'svc-royal' }]]),
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
        const lines = request.cart.seats.flatMap((seat) => seat.lines);
        expect(found.assignments.map((a) => a.lineId).sort()).toEqual(
          lines.map((l) => l.lineId).sort(),
        );
        const declared = asked.windows[0] as { from: string; to: string };
        for (const assignment of found.assignments) {
          const line = lines.find((l) => l.lineId === assignment.lineId);
          // A SPECIFIC barber the request asked for is the barber the match names.
          if (line?.barberId) expect(assignment.barberId).toBe(line.barberId);
          // Inside the declared window, after the lead floor.
          expect(assignment.slot.startMs).toBeGreaterThanOrEqual(
            at(declared.from),
          );
          expect(assignment.slot.endMs).toBeLessThanOrEqual(at(declared.to));
          expect(assignment.slot.startMs).toBeGreaterThanOrEqual(
            AvailabilitySystem.leadFloorMs(NOW_MS, POLICY),
          );
          // At the shop's own rostered time, never on the barber's busy time.
          const barberDay = day.find((b) => b.barberId === assignment.barberId);
          expect(
            barberDay?.windows.some(
              (w) =>
                w.locationId === found.locationId &&
                DAY.dayStartMs + w.startMinutes * 60_000 <=
                  assignment.slot.startMs &&
                assignment.slot.endMs <= DAY.dayStartMs + w.endMinutes * 60_000,
            ),
          ).toBe(true);
          for (const taken of barberDay?.busy ?? []) {
            expect(TimeInterval.overlaps(taken, assignment.slot)).toBe(false);
          }
        }
      }),
      { numRuns: 250 },
    );
    // Not vacuous: plenty of the random days did send something.
    expect(sent).toBeGreaterThan(15);
  });
});

describe('WaitlistSystem.planMatch — one plan, notification and status together', () => {
  const request = requestFor({
    locationId: CENTER,
    seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
    windows: [{ from: '10:00', to: '12:00' }],
  });
  const found = matchIn(
    snapshot([{ id: 'ivan', segments: works(CENTER) }]),
    request,
  );

  it('writes the notification FACTS under the owner and moves the request to matched', () => {
    if (found === null) throw new Error('bad fixture');
    const plan = unwrapOk(
      WaitlistSystem.planMatch(request, found, NOW_MS, () => 'n-1'),
    );
    expect(plan.status).toEqual({ kind: WaitlistState.Matched, atMs: NOW_MS });
    expect(plan.notification).toEqual({
      id: 'n-1',
      kind: NotificationKind.WaitlistMatch,
      requestId: 'wl-1',
      dayKey: DAY_KEY,
      payload: {
        kind: NotificationKind.WaitlistMatch,
        requestId: 'wl-1',
        startMs: found.startMs,
        zone: ZONE,
      },
      sentAtMs: NOW_MS,
      readAtMs: null,
    });
    expect(plan.writes.map((op) => [op.kind, op.path])).toEqual([
      [WriteKind.Create, ['users', OWNER, 'notifications', 'n-1']],
      [WriteKind.Update, ['waitlistRequests', 'wl-1']],
    ]);
    // No words: the inbox words the facts in the reader's locale.
    expect(JSON.stringify(plan)).not.toMatch(/Освободи|"title"|"deepLink"/);
  });

  it('tells a terminal request nothing', () => {
    if (found === null) throw new Error('bad fixture');
    const booked: WaitlistRequestEntity = {
      ...request,
      status: { kind: WaitlistState.Booked, atMs: NOW_MS },
    };
    const error = unwrapErr(
      WaitlistSystem.planMatch(booked, found, NOW_MS, () => 'n-1'),
    );
    expect(error.code).toBe(SchedulingErrorCode.WaitlistInvalidTransition);
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
