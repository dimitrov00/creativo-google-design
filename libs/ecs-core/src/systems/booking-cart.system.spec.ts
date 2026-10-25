import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BarberPref,
  BarberPreference,
  BookingFlowState,
  BookingFlowStep,
  type SeatAssignment,
  BookingPolicy,
  BookingCart,
  type CartLine,
  type CartSeatLines,
  SeatKey,
  DayWindows,
  FlexibleWhen,
  MinuteRange,
  Party,
  PartyMember,
  PartyRole,
  RosterWindow,
  SeatLabel,
  SeatOccupant,
  SubjectRelationship,
  type ShopNow,
  RequestedSubjectRole,
  type ChairTime,
  BlockKind,
  DayHours,
  LocationStatus,
  MinuteBlock,
  SeatArrangement,
  ShopCoverage,
  BookingFlowEventKind,
  PrefillCompanions,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  CartLineId,
  GuestId,
  LocationId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  WaitlistRequestId,
  type MinuteOfDay,
} from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import {
  deepFreeze,
  endMinute,
  FIXTURE_TIME_ZONE,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  duration,
  minuteCount,
  minuteDelta,
  termsFixture,
  customerOf,
  FIXTURE_NOW,
  barberBusyDayFixture,
  barberScheduleFixture,
  locationFixture,
  scheduleExceptionFixture,
  serviceFixture,
} from '@core/testing';
import {
  type AvailabilityLine,
  AvailabilitySystem,
} from './availability.system';
import {
  BookingCartSystem,
  type CartBarberDay,
  type CartRider,
  type CartService,
  type DayDocs,
  type DayQuery,
  type PrefillSeat,
} from './booking-cart.system';
import { BookingFlowSystem } from './booking-flow.system';
import { RosterSystem } from './roster.system';
import { ZonedTimeSystem } from './zoned-time.system';
import cartSystemSource from './booking-cart.system.ts?raw';

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const SELF = SeatKey.text(SeatKey.self());
const GUEST = SeatKeyText.of('guest-0');
/** A guest's seat key — the guest's own id, as text. */
const seatOf = (guestId: GuestId): SeatKeyText =>
  SeatKey.text(SeatKey.guest(guestId));
const svc = (raw: string): ServiceId => ServiceId.of(raw);
const barber = (raw: string): BarberId => BarberId.of(raw);
const shop = (raw: string): LocationId => LocationId.of(raw);

function line(
  serviceId: string,
  barberId: string | null = null,
  variantId: string | null = null,
): BookingCart.NewLine {
  return {
    serviceId: svc(serviceId),
    variantId: variantId === null ? null : ServiceVariantId.of(variantId),
    barberId: barberId === null ? null : barber(barberId),
    locationId: null,
  };
}

const CUT = line('svc-classic-cut');
/** A SECOND, different service — one seat may hold several, just not twins. */
const BEARD = line('svc-beard');

/** `addLine` refuses a duplicate; these fixtures know their input is legal. */
function added(
  cart: BookingCart,
  seatKey: SeatKeyText,
  newLine: BookingCart.NewLine,
): BookingCart {
  return unwrapOk(BookingCart.addLine(cart, seatKey, newLine));
}

/** A line as a stored cart holds it — its ids by construction. */
function storedLine(
  seatKey: string,
  lineId: string,
  serviceId: string,
  barberId: BarberId | null = null,
): CartLine {
  return {
    lineId: CartLineId.of(lineId),
    seatKey: SeatKeyText.of(seatKey),
    serviceId: svc(serviceId),
    variantId: null,
    barberId,
    locationId: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * Copied (not moved) from the legacy scheduling `booking-cart.spec.ts` (deleted
 * in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1) — all
 * 24 cases, re-targeted from the `BookingCart` class to the `BookingCart`
 * component (its operations) and `BookingCartSystem.salvage` (the forgiving
 * `reconstitute`).
 * ═════════════════════════════════════════════════════════════════════ */

describe('SeatKey.text', () => {
  it('distinguishes the booker from every guest', () => {
    expect(SeatKey.text(SeatKey.self())).toBe('self');
    expect(seatOf(GuestId.of('guest-0'))).toBe('guest-0');
    expect(seatOf(GuestId.of('guest-1'))).toBe('guest-1');
  });
});

describe('BookingCart.addLine / removeLine', () => {
  it('starts empty and scopes lines to the seat that added them', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);

    expect(BookingCart.isEmpty(cart)).toBe(false);
    expect(BookingCart.lineCount(cart)).toBe(1);
    expect(BookingCart.linesFor(cart, SELF)).toHaveLength(1);
    expect(BookingCart.linesFor(cart, GUEST)).toHaveLength(0);
  });

  it('leaves the original cart untouched (every mutation returns a new cart)', () => {
    const empty = BookingCart.empty();
    BookingCart.addLine(empty, SELF, CUT);
    expect(BookingCart.isEmpty(empty)).toBe(true);
  });

  it('REFUSES the same service twice for one person', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const twice = BookingCart.addLine(cart, SELF, CUT);

    expect(twice.ok).toBe(false);
    expect(!twice.ok && twice.error.errorCode).toBe(
      'SCHEDULING_BOOKING_CART_DUPLICATE_SERVICE',
    );
    expect(BookingCart.linesFor(cart, SELF)).toHaveLength(1);
  });

  it('lets one seat hold several DIFFERENT services', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), SELF, BEARD);
    const [first, second] = BookingCart.linesFor(cart, SELF);
    expect(BookingCart.linesFor(cart, SELF)).toHaveLength(2);
    expect(first?.lineId).not.toBe(second?.lineId);
  });

  it('lets the SAME service go to two different people', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), GUEST, CUT);
    expect(BookingCart.linesFor(cart, SELF)).toHaveLength(1);
    expect(BookingCart.linesFor(cart, GUEST)).toHaveLength(1);
  });

  it('never reuses a line id after add → remove → add (§7.7 discipline)', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const firstId = (BookingCart.linesFor(cart, SELF)[0] as CartLine).lineId;

    const removed = unwrapOk(BookingCart.removeLine(cart, SELF, firstId));
    expect(BookingCart.lineCount(removed)).toBe(0);

    const readded = added(removed, SELF, CUT);
    expect(BookingCart.linesFor(readded, SELF)[0]?.lineId).not.toBe(firstId);
  });

  it('fails removing a line the seat does not hold', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const result = BookingCart.removeLine(
      cart,
      SELF,
      CartLineId.forSequence(99),
    );
    expect(!result.ok && result.error.errorCode).toBe(
      'SCHEDULING_BOOKING_CART_LINE_NOT_FOUND',
    );
  });

  it('fails removing another seat’s line rather than silently succeeding', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const selfLineId = (BookingCart.linesFor(cart, SELF)[0] as CartLine).lineId;
    expect(BookingCart.removeLine(cart, GUEST, selfLineId).ok).toBe(false);
  });

  it('drops a seat entirely from the cart once its last line goes', () => {
    const cart = added(BookingCart.empty(), GUEST, CUT);
    const removed = unwrapOk(
      BookingCart.removeLine(
        cart,
        GUEST,
        (BookingCart.linesFor(cart, GUEST)[0] as CartLine).lineId,
      ),
    );
    expect(removed.cartSeats).toHaveLength(0);
  });
});

describe('BookingCart.setVariant / setBarber', () => {
  it('re-points one line without disturbing its neighbours', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), SELF, BEARD);
    const [first, second] = BookingCart.linesFor(cart, SELF) as [
      CartLine,
      CartLine,
    ];

    const updated = unwrapOk(
      BookingCart.setVariant(
        cart,
        SELF,
        first.lineId,
        ServiceVariantId.of('long'),
      ),
    );

    const lines = BookingCart.linesFor(updated, SELF);
    expect(lines[0]?.variantId).toBe('long');
    expect(lines[1]?.variantId).toBeNull();
    expect(lines[1]?.lineId).toBe(second.lineId);
  });

  it('moves a line from "anyone" to a specific barber and back', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const lineId = (BookingCart.linesFor(cart, SELF)[0] as CartLine).lineId;

    const pinned = unwrapOk(
      BookingCart.setBarber(cart, SELF, lineId, barber('ivan')),
    );
    expect(
      BarberPref.fromBarberId(
        (BookingCart.linesFor(pinned, SELF)[0] as CartLine).barberId,
      ).barberPreference,
    ).toBe(BarberPreference.Specific);

    const loosened = unwrapOk(
      BookingCart.setBarber(pinned, SELF, lineId, null),
    );
    expect(
      BarberPref.fromBarberId(
        (BookingCart.linesFor(loosened, SELF)[0] as CartLine).barberId,
      ).barberPreference,
    ).toBe(BarberPreference.Any);
  });

  it('fails on an unknown line', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(
      BookingCart.setVariant(cart, SELF, CartLineId.forSequence(99), null).ok,
    ).toBe(false);
  });
});

describe('BookingCart.dropSeat', () => {
  it('forgets a departing guest’s lines and leaves everyone else alone', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), GUEST, CUT);
    const dropped = BookingCart.dropSeat(cart, GUEST);

    expect(BookingCart.linesFor(dropped, GUEST)).toHaveLength(0);
    expect(BookingCart.linesFor(dropped, SELF)).toHaveLength(1);
    expect(BookingCart.lineCount(dropped)).toBe(1);
  });

  it('is a no-op for a seat that holds nothing', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(BookingCart.dropSeat(cart, GUEST)).toBe(cart);
  });

  it('never rewinds the line counter — a re-added guest cannot inherit an id', () => {
    const cart = added(BookingCart.empty(), GUEST, CUT);
    const droppedLineId = (BookingCart.linesFor(cart, GUEST)[0] as CartLine)
      .lineId;

    const readded = added(BookingCart.dropSeat(cart, GUEST), GUEST, CUT);
    expect(BookingCart.linesFor(readded, GUEST)[0]?.lineId).not.toBe(
      droppedLineId,
    );
  });
});

describe('BookingCartSystem.salvage — the forgiving reconstitute', () => {
  it('round-trips lines, ids and the counter', () => {
    const original = added(
      added(BookingCart.empty(), SELF, line('svc-classic-cut', null, 'long')),
      GUEST,
      line('svc-classic-cut', 'ivan'),
    );

    const restored = unwrapOk(
      BookingCartSystem.salvage(JSON.parse(JSON.stringify(original))),
    );

    expect(BookingCart.lineCount(restored)).toBe(2);
    expect(BookingCart.linesFor(restored, SELF)[0]?.variantId).toBe('long');
    expect(
      BarberPref.fromBarberId(
        (BookingCart.linesFor(restored, GUEST)[0] as CartLine).barberId,
      ),
    ).toEqual(BarberPref.specific(barber('ivan')));
    // The restored cart must keep minting FORWARD of the persisted counter,
    // or a reload would resurrect an id the pre-reload session already used.
    const beforeIds = original.cartSeats.flatMap((seat) =>
      seat.lines.map((l) => l.lineId),
    );
    const next = BookingCart.linesFor(added(restored, SELF, BEARD), SELF).at(
      -1,
    ) as CartLine;
    expect(beforeIds).not.toContain(next.lineId);
  });

  it('rejects a corrupt sequence counter rather than coercing it', () => {
    const error = unwrapErr(
      BookingCartSystem.salvage({ cartSeats: [], cartNextSequence: -1 }),
    );
    expect(error.errorCode).toBe(
      'SCHEDULING_BOOKING_CART_INVALID_LINE_SEQUENCE',
    );
  });

  it('drops a malformed line but keeps the rest of the draft', () => {
    const restored = unwrapOk(
      BookingCartSystem.salvage({
        cartSeats: [
          {
            seatKey: SELF,
            lines: [
              storedLine('self', 'line-0', ''),
              storedLine('self', 'line-1', 'svc-fade'),
            ],
          },
        ],
        cartNextSequence: 2,
      }),
    );

    expect(BookingCart.lineCount(restored)).toBe(1);
    expect(BookingCart.linesFor(restored, SELF)[0]?.serviceId).toBe('svc-fade');
  });
});

describe('BookingCart.acceptedBarbers', () => {
  const POOL = ['ivan', 'niko', 'stefan'].map(barber);

  function pinned(
    cart: BookingCart,
    seatKey: SeatKeyText,
    id: string,
  ): BookingCart {
    const last = BookingCart.linesFor(cart, seatKey).at(-1);
    if (last === undefined) throw new Error('bad fixture');
    return unwrapOk(
      BookingCart.setBarber(cart, seatKey, last.lineId, barber(id)),
    );
  }

  it('narrows the pool to the barber a single pinned line wants', () => {
    const cart = pinned(added(BookingCart.empty(), SELF, CUT), SELF, 'ivan');
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual(['ivan']);
  });

  it('keeps every barber a party pins, in the pool’s order', () => {
    const withGuest = added(
      pinned(added(BookingCart.empty(), SELF, CUT), SELF, 'stefan'),
      GUEST,
      BEARD,
    );
    const cart = pinned(withGuest, GUEST, 'ivan');
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual(['ivan', 'stefan']);
  });

  it('accepts the whole pool as soon as one line takes anyone', () => {
    const cart = added(
      pinned(added(BookingCart.empty(), SELF, CUT), SELF, 'ivan'),
      SELF,
      BEARD,
    );
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual([
      'ivan',
      'niko',
      'stefan',
    ]);
  });

  it('accepts nobody for an empty cart, and nobody outside the pool', () => {
    expect(BookingCart.acceptedBarbers(BookingCart.empty(), POOL)).toEqual([]);
    const cart = pinned(added(BookingCart.empty(), SELF, CUT), SELF, 'ivo');
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual([]);
  });

  it('is exactly the pool barbers some line’s preference matches', () => {
    const pref = fc.option(fc.constantFrom('ivan', 'niko', 'stefan', 'ivo'), {
      nil: null,
    });
    const seat = fc.array(pref, { minLength: 1, maxLength: 3 });
    fc.assert(
      fc.property(
        fc.array(seat, { maxLength: 3 }),
        fc.subarray(['ivan', 'niko', 'stefan', 'ivo']),
        (seats, poolIds) => {
          const restored = unwrapOk(
            BookingCartSystem.salvage({
              cartSeats: seats.map((prefs, index): CartSeatLines => {
                const seatKey = index === 0 ? 'self' : `guest-${index}`;
                return {
                  seatKey: SeatKeyText.of(seatKey),
                  lines: prefs.map((id, at) =>
                    storedLine(
                      seatKey,
                      `line-${index}-${at}`,
                      `svc-${at}`,
                      id === null ? null : barber(id),
                    ),
                  ),
                };
              }),
              cartNextSequence: 99,
            }),
          );
          const pool = poolIds.map(barber);
          const prefs = restored.cartSeats.flatMap((entry) =>
            entry.lines.map((l) => BarberPref.fromBarberId(l.barberId)),
          );
          const expected = pool.filter((id) =>
            prefs.some((p) => BarberPref.matches(p, id)),
          );
          expect(BookingCart.acceptedBarbers(restored, pool)).toEqual(expected);
        },
      ),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Copied (not moved) from the legacy booking application lib's
 * `party-shops.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1) — all 9 cases,
 * re-targeted to `BookingCartSystem.shopsServingParty` / `partyServicesOf` over
 * `CartService` structs.
 * ═════════════════════════════════════════════════════════════════════ */

const SHOPS = ['loc-center', 'loc-mladost', 'loc-lozenets'].map(shop);

/** A 30-minute service offered at `locationIds` (empty ⇒ every shop). */
function serviceAt(id: string, locationIds: readonly string[]): CartService {
  return {
    id: svc(id),
    ...termsFixture(2000, 30),
    offerings: [],
    locationIds: locationIds.map(shop),
  };
}

/** A cut everywhere, a beard at Center, a perm at Center and Mladost. */
const CATALOG = [
  serviceAt('svc-cut', []),
  serviceAt('svc-beard', ['loc-center']),
  serviceAt('svc-perm', ['loc-center', 'loc-mladost']),
];

function party(lines: readonly string[], riders: readonly string[] = []) {
  return {
    lineServiceIds: lines.map(svc),
    riderServiceIds: riders.map(svc),
  };
}

function serving(
  asked: ReturnType<typeof party>,
  services: readonly CartService[] = CATALOG,
): readonly string[] {
  return BookingCartSystem.shopsServingParty(asked, services, SHOPS);
}

describe('BookingCartSystem.shopsServingParty — the shops that can serve the whole visit', () => {
  it('keeps every shop, in the order given, for services every shop offers', () => {
    expect(serving(party(['svc-cut'], ['svc-cut']))).toEqual(SHOPS);
    expect(serving(party([]))).toEqual(SHOPS);
  });

  it('keeps only the shops that offer EVERY service on the visit', () => {
    expect(serving(party(['svc-beard']))).toEqual(['loc-center']);
    expect(serving(party(['svc-perm']))).toEqual(['loc-center', 'loc-mladost']);
    expect(serving(party(['svc-perm', 'svc-cut']))).toEqual([
      'loc-center',
      'loc-mladost',
    ]);
  });

  it('holds a carried seat to the same rule as a cart line', () => {
    expect(serving(party(['svc-cut'], ['svc-beard']))).toEqual(['loc-center']);
    expect(serving(party(['svc-perm'], ['svc-beard']))).toEqual(['loc-center']);
  });

  it('keeps no shop when no single shop offers all of it', () => {
    const lozenetsOnly = serviceAt('svc-color', ['loc-lozenets']);
    expect(
      serving(party(['svc-beard', 'svc-color']), [...CATALOG, lozenetsOnly]),
    ).toEqual([]);
  });

  it('asks nothing of a shop for a cart line the catalog does not know — the grid dropped it', () => {
    expect(serving(party(['svc-retired']))).toEqual(SHOPS);
  });

  it('serves a carried seat the catalog does not know NOWHERE — the server refuses it', () => {
    expect(serving(party(['svc-cut'], ['svc-retired']))).toEqual([]);
  });

  it('never gains a shop when the visit asks for more', () => {
    const ids = ['svc-cut', 'svc-beard', 'svc-perm', 'svc-retired'];
    const ask = fc.record({
      lines: fc.subarray(ids),
      riders: fc.subarray(ids),
    });
    fc.assert(
      fc.property(ask, ask, (smaller, extra) => {
        const before = serving(party(smaller.lines, smaller.riders));
        const after = serving(
          party(
            [...smaller.lines, ...extra.lines],
            [...smaller.riders, ...extra.riders],
          ),
        );
        expect(after.every((id) => before.includes(id))).toBe(true);
      }),
    );
  });
});

describe('BookingCartSystem.partyServicesOf — what a visit asks a shop for', () => {
  it('names every cart line’s service and every carried seat’s', () => {
    const cart = added(
      added(BookingCart.empty(), SELF, line('svc-cut')),
      SELF,
      line('svc-beard'),
    );
    const son: CartRider = {
      serviceId: svc('svc-perm'),
      barberId: barber('niko'),
      offsetMinutes: minuteDelta(0),
      terms: lineTerms(30),
    };

    const asked = BookingCartSystem.partyServicesOf(cart, [son]);

    expect(asked.lineServiceIds).toEqual(['svc-cut', 'svc-beard']);
    expect(asked.riderServiceIds).toEqual(['svc-perm']);
    expect(BookingCartSystem.partyServicesOf(cart, []).riderServiceIds).toEqual(
      [],
    );
  });
});

describe('booking-cart.system — the lower module', () => {
  // The flow consumes the cart system, so the flow system imports it. The
  // cart importing anything back is the cycle this module is cut free of.
  it('imports nothing from the flow system that consumes it', () => {
    expect(cartSystemSource).not.toMatch(/from\s+'\.\/booking-flow\.system/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Copied (not moved) from the legacy booking application lib's
 * `observe-availability.use-case.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1) — 15 of its 16 cases (the
 * DateRange fixture sanity is not this system's), re-targeted from the use case
 * + reader to `BookingCartSystem .toAvailabilityLines` / `optionsForDay` over
 * ONE shop day's local minutes (Law 7.3): the reader's padding is
 * `AvailabilitySystem.paddedBusy`, its shop filter `RosterSystem.windowsAt`,
 * "now" a `ShopNow`.
 * ═════════════════════════════════════════════════════════════════════ */

const DAY = localDate('2026-08-03');
const CENTER = shop('loc-center');
const MLADOST = shop('loc-mladost');

/** A wall-clock minute of the fixture day — a start. */
function at(hour: number, minutes = 0): MinuteOfDay {
  return minute(hour * 60 + minutes);
}
const mins = (hour: number, minutes = 0): number => hour * 60 + minutes;
/** A roster window on the fixture day, `[from, to)` in minutes. */
const rosterWindow = (
  barberId: string,
  locationId: LocationId,
  from: number,
  to: number,
) => RosterWindow.of(barber(barberId), locationId, minute(from), endMinute(to));
/** A span of the fixture day, `[from, to)` in minutes. */
const span = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
/** "Now" on the fixture day at a wall-clock time (Sofia, summer: +03:00). */
function nowAt(hour: number, minutes = 0): ShopNow {
  const pad = (n: number) => String(n).padStart(2, '0');
  return ZonedTimeSystem.shopNow(
    utcMs(`2026-08-03T${pad(hour)}:${pad(minutes)}:00+03:00`),
    FIXTURE_TIME_ZONE,
  );
}
/** A line's terms in plain minutes — the engine's `LineTerms`. */
const lineTerms = (minutes: number, before = 0, after = 0) => ({
  durationMinutes: duration(minutes),
  padBeforeMinutes: minuteCount(before),
  padAfterMinutes: minuteCount(after),
});

/**
 * A haircut Ivan does in 30 minutes and Niko in 45, with Niko needing 15
 * minutes of cleanup after. Both axes of the terms matrix in one fixture.
 */
function fadeService(): CartService {
  return {
    id: svc('svc-fade'),
    ...termsFixture(2500, 40),
    offerings: [
      { barberId: barber('ivan'), overrides: [], ...termsFixture(2500, 30) },
      {
        barberId: barber('niko'),
        overrides: [],
        ...termsFixture(2800, 45, 0, 15),
      },
    ],
    locationIds: [CENTER],
  };
}

function cartWithFade(barberId: string | null = null): BookingCart {
  return added(BookingCart.empty(), SELF, line('svc-fade', barberId));
}

function barberDay(
  id: string,
  hours: readonly [number, number],
): CartBarberDay {
  return {
    barberId: barber(id),
    windows: [rosterWindow(id, CENTER, hours[0], hours[1])],
    busy: [],
  };
}

function policyWithLead(minLeadMinutes: number): BookingPolicy {
  return unwrapOk(
    BookingPolicy.create({ ...BookingPolicy.DEFAULT, minLeadMinutes }),
  );
}

/** The day's options for a bag, as the grid asks for them. */
function optionsFor(input: {
  readonly cart: BookingCart;
  readonly services: readonly CartService[];
  readonly barbers: readonly CartBarberDay[];
  readonly policy: BookingPolicy;
  readonly now: ShopNow;
  readonly riders?: readonly CartRider[];
}) {
  return BookingCartSystem.optionsForDay({
    cart: input.cart,
    services: input.services,
    riders: input.riders ?? [],
    barbers: input.barbers,
    localDate: DAY,
    policy: input.policy,
    notBefore: AvailabilitySystem.leadFloor(input.now, input.policy, DAY),
    within: null,
    budget: AvailabilitySystem.DEFAULT_BUDGET,
  });
}

function startsOf(
  options: ReturnType<typeof BookingCartSystem.optionsForDay>,
): readonly MinuteOfDay[] {
  const starts: MinuteOfDay[] = [];
  for (const { option } of options) {
    if (!starts.includes(option.startMinutes)) starts.push(option.startMinutes);
  }
  return starts;
}

describe('BookingCartSystem.toAvailabilityLines', () => {
  it('resolves BOTH terms axes — per barber, and the catalog default', () => {
    const lines = BookingCartSystem.toAvailabilityLines(
      cartWithFade(),
      [fadeService()],
      [barber('ivan'), barber('niko')],
    );

    expect(lines).toHaveLength(1);
    const first = lines[0] as AvailabilityLine;
    // Default = the catalog terms before anyone is picked.
    expect(first.durationMinutes).toBe(40);
    expect(first.termsByBarber[0]).toEqual({
      durationMinutes: 30,
      padBeforeMinutes: 0,
      padAfterMinutes: 0,
    });
    // Niko's cleanup rides along as a pad, NOT folded into the duration.
    expect(first.termsByBarber[1]).toEqual({
      durationMinutes: 45,
      padBeforeMinutes: 0,
      padAfterMinutes: 15,
    });
  });

  it('names each line’s PERSON by its seat — the key the engine keeps one person in one chair by', () => {
    const cart = added(
      cartWithFade(),
      SeatKeyText.of('guest-3'),
      line('svc-fade'),
    );

    const lines = BookingCartSystem.toAvailabilityLines(
      cart,
      [fadeService()],
      [barber('ivan'), barber('niko')],
    );

    expect(lines.map((l) => l.personKey)).toEqual(['self', 'guest-3']);
  });

  it('never offers one person’s two services in two chairs at once', () => {
    // The booker with a fade AND a beard, both «any barber», and two barbers
    // free all morning. Person-blind, the grid offered both at 09:00.
    const beard: CartService = {
      id: svc('svc-beard'),
      ...termsFixture(1500, 30),
      offerings: [],
      locationIds: [CENTER],
    };
    const cart = added(cartWithFade(), SELF, line('svc-beard'));
    const lines = BookingCartSystem.toAvailabilityLines(
      cart,
      [fadeService(), beard],
      [barber('ivan'), barber('niko')],
    );

    const options = optionsFor({
      cart,
      services: [fadeService(), beard],
      barbers: [
        barberDay('ivan', [mins(9), mins(12)]),
        barberDay('niko', [mins(9), mins(12)]),
      ],
      policy: policyWithLead(0),
      now: nowAt(6),
    });

    expect(options.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.personKey === 'self')).toBe(true);
    for (const { option } of options) {
      const [first, second] = option.assignments;
      if (!first || !second) throw new Error('two services, two seats');
      expect(MinuteRange.overlaps(first, second)).toBe(false);
    }
  });

  it('DROPS a line whose service is not in the snapshot', () => {
    expect(
      BookingCartSystem.toAvailabilityLines(
        cartWithFade(),
        [],
        [barber('ivan')],
      ),
    ).toEqual([]);
  });
});

describe('BookingCartSystem.optionsForDay', () => {
  const policy = policyWithLead(120);
  const base = (cart = cartWithFade()) => ({
    cart,
    services: [fadeService()],
    policy,
    now: nowAt(6),
  });

  it('sells each barber their OWN duration', () => {
    const options = optionsFor({
      ...base(),
      barbers: [
        barberDay('ivan', [mins(12), mins(12, 30)]),
        barberDay('niko', [mins(14), mins(15)]),
      ],
    });

    const byBarber = new Map(
      options.map(({ option }) => {
        const first = option.assignments[0];
        return [
          first?.barberId,
          first === undefined ? 0 : first.endMinutes - first.startMinutes,
        ];
      }),
    );
    expect(byBarber.get(barber('ivan'))).toBe(30);
    expect(byBarber.get(barber('niko'))).toBe(45);
  });

  it('keeps ONE arrangement per start, so a long day reaches the evening', () => {
    const options = optionsFor({
      ...base(),
      barbers: [
        barberDay('ivan', [mins(9), mins(20)]),
        barberDay('niko', [mins(9), mins(20)]),
      ],
    });
    const starts = startsOf(options);
    expect(options.length).toBe(starts.length);
    expect(Math.max(...starts)).toBeGreaterThan(at(17));
  });

  it('applies the minimum lead time as a floor on the first start', () => {
    // "Now" is 10:00 with a 120-minute lead, so nothing before 12:00.
    const options = optionsFor({
      ...base(),
      now: nowAt(10),
      barbers: [barberDay('ivan', [mins(9), mins(18)])],
    });
    expect(startsOf(options)[0]).toBe(at(12));
  });

  it('returns nothing for an empty cart', () => {
    const options = optionsFor({
      ...base(BookingCart.empty()),
      barbers: [barberDay('ivan', [mins(9), mins(18)])],
    });
    expect(options).toEqual([]);
  });

  it('offers a gap only the faster barber fits', () => {
    // 30 minutes of room, both barbers free, `any` preference. Ivan fits at
    // 30; Niko needs 45 + 15 cleanup. The slot must still be offered.
    const options = optionsFor({
      ...base(),
      barbers: [
        barberDay('ivan', [mins(12), mins(12, 30)]),
        barberDay('niko', [mins(12), mins(12, 30)]),
      ],
    });
    expect(startsOf(options)).toEqual([at(12)]);
    for (const { option } of options) {
      expect(option.assignments[0]?.barberId).toBe('ivan');
    }
  });
});

describe('BookingCartSystem.optionsForDay — a move', () => {
  const policy = policyWithLead(120);
  /** The client keeps Ivan for their fade: 30 minutes with him. */
  const cart = cartWithFade('ivan');
  /** The son the shop seated beside the client, 45 minutes with Niko. */
  const son: CartRider = {
    serviceId: svc('svc-fade'),
    barberId: barber('niko'),
    offsetMinutes: minuteDelta(0),
    terms: lineTerms(45),
  };

  /** Stored geometry, padded the way the grid's read pads it. */
  function stored(
    days: readonly {
      readonly id: string;
      readonly window: readonly [number, number];
      readonly spans: readonly MinuteRange[];
      readonly turnaroundMinutes?: number;
    }[],
    release: readonly ChairTime[] = [],
  ): readonly CartBarberDay[] {
    return days.map((entry) => ({
      barberId: barber(entry.id),
      windows: [
        rosterWindow(entry.id, CENTER, entry.window[0], entry.window[1]),
      ],
      busy: AvailabilitySystem.paddedBusy(
        barber(entry.id),
        { blocks: entry.spans },
        { turnaroundMinutes: minuteCount(entry.turnaroundMinutes ?? 0) },
        release,
      ),
    }));
  }

  it('drops every start where a carried seat’s barber is busy at the shifted time', () => {
    // Niko is somebody else's until 13:00.
    const barbers = stored([
      { id: 'ivan', window: [mins(12), mins(14)], spans: [] },
      {
        id: 'niko',
        window: [mins(12), mins(14)],
        spans: [span(mins(12), mins(13))],
      },
    ]);
    const services = [fadeService()];

    const alone = optionsFor({
      cart,
      services,
      barbers,
      policy,
      now: nowAt(6),
    });
    const carried = optionsFor({
      cart,
      services,
      barbers,
      policy,
      now: nowAt(6),
      riders: [son],
    });

    expect(startsOf(alone)[0]).toBe(at(12));
    // 13:30 goes too: the son's 45 minutes would run past Niko's day.
    expect(startsOf(carried)).toEqual([at(13), at(13, 15)]);
  });

  it('never lets the moved visit’s OWN seats block its move — the client’s and the carried son’s alike', () => {
    const own: readonly ChairTime[] = [
      {
        barberId: barber('ivan'),
        startMinutes: at(12),
        endMinutes: endMinute(mins(12, 30)),
      },
      {
        barberId: barber('niko'),
        startMinutes: at(12),
        endMinutes: endMinute(mins(12, 45)),
      },
    ];
    const geometry = [
      {
        id: 'ivan',
        window: [mins(12), mins(14)] as const,
        spans: [span(mins(12), mins(12, 30))],
        turnaroundMinutes: 10,
      },
      {
        id: 'niko',
        window: [mins(12), mins(14)] as const,
        spans: [span(mins(12), mins(12, 45))],
        turnaroundMinutes: 10,
      },
    ];
    const services = [fadeService()];

    const kept = optionsFor({
      cart,
      services,
      barbers: stored(geometry),
      policy,
      now: nowAt(6),
      riders: [son],
    });
    const released = optionsFor({
      cart,
      services,
      barbers: stored(geometry, own),
      policy,
      now: nowAt(6),
      riders: [son],
    });

    // Without the release the visit collides with itself, turnaround and
    // all: the son's old chair keeps Niko until 12:55.
    expect(startsOf(kept)[0]).toBe(at(12, 55));
    // With it, the day is the whole day again, for the lines and the rider.
    expect(startsOf(released).slice(0, 2)).toEqual([at(12), at(12, 15)]);
  });
});

describe('BookingCartSystem.optionsForDay — a shop that cannot serve somebody on the visit', () => {
  const policy = policyWithLead(0);
  const cut = () => serviceAt('svc-cut', []);
  const beard = () => serviceAt('svc-beard', ['loc-center']);

  /** Ivan and Niko work Center 12:00–13:00 and Mladost 15:00–16:00; nobody is booked. */
  const pool = (): readonly CartBarberDay[] =>
    ['ivan', 'niko'].map((id) => ({
      barberId: barber(id),
      windows: [
        rosterWindow(id, CENTER, mins(12), mins(13)),
        rosterWindow(id, MLADOST, mins(15), mins(16)),
      ],
      busy: [],
    }));

  const son = (serviceId: string): CartRider => ({
    serviceId: svc(serviceId),
    barberId: barber('niko'),
    offsetMinutes: minuteDelta(0),
    terms: lineTerms(30),
  });

  const cartOf = (serviceId: string): BookingCart =>
    added(BookingCart.empty(), SELF, line(serviceId, 'ivan'));

  function shopsOffered(input: {
    readonly cart?: BookingCart;
    readonly services?: readonly CartService[];
    readonly locationId?: LocationId | null;
    readonly riders?: readonly CartRider[];
  }): readonly string[] {
    const locationId = input.locationId ?? null;
    // The read narrows to the named shop's windows, as the grid's reader does.
    const barbers =
      locationId === null
        ? pool()
        : pool().map((entry) => ({
            ...entry,
            windows: RosterSystem.windowsAt(entry.windows, locationId),
          }));
    const options = optionsFor({
      cart: input.cart ?? cartOf('svc-cut'),
      services: input.services ?? [cut(), beard()],
      barbers,
      policy,
      now: nowAt(6),
      riders: input.riders ?? [],
    });
    return [...new Set(options.map((entry) => entry.locationId))];
  }

  it('offers every shop to a party every shop can serve', () => {
    expect(shopsOffered({})).toEqual(['loc-center', 'loc-mladost']);
    expect(shopsOffered({ riders: [son('svc-cut')] })).toEqual([
      'loc-center',
      'loc-mladost',
    ]);
  });

  it('offers no time at a shop that does not offer a carried seat’s service — the other shop still does', () => {
    expect(shopsOffered({ riders: [son('svc-beard')] })).toEqual([
      'loc-center',
    ]);
    expect(
      shopsOffered({ locationId: MLADOST, riders: [son('svc-beard')] }),
    ).toEqual([]);
    expect(
      shopsOffered({ locationId: CENTER, riders: [son('svc-beard')] }),
    ).toEqual(['loc-center']);
  });

  it('offers nothing for a carried seat whose service the catalog no longer holds', () => {
    expect(
      shopsOffered({ services: [cut()], riders: [son('svc-beard')] }),
    ).toEqual([]);
  });

  it('holds the cart’s own services to the same rule as a carried seat’s', () => {
    expect(shopsOffered({ cart: cartOf('svc-beard') })).toEqual(['loc-center']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Copied (not moved) from
 * libs/features/client/booking/src/lib/booking-flow.store.spec.ts — the
 * store-helper cases (19): the commit request, the prefilled bag, the
 * restored draft, the waitlist landing's placeholders and `firstUnusedLabel`,
 * re-targeted from the Angular store to the system functions it calls.
 * ═════════════════════════════════════════════════════════════════════ */

const guestLabel = (ordinal: number): string => `Guest ${ordinal}`;
const CLIENT = UserId.of('client-1');
const account = (userId: string, relationship: SubjectRelationship) =>
  SeatOccupant.account(
    UserId.of(userId),
    customerOf(UserId.of(userId)),
    relationship,
  );
const anonymous = (label: string) =>
  SeatOccupant.anonymous(SeatLabel.of(label));

function seat(
  occupant: SeatOccupant,
  barberId: string,
  serviceId: string,
): PrefillSeat {
  return {
    serviceId: svc(serviceId),
    variantId: null,
    barberId: barber(barberId),
    ...occupant,
  };
}

/** A father, his son (an ACCOUNT staff seated beside him) and a guest with two services. */
const partyVisit: readonly PrefillSeat[] = [
  seat(account('client-1', SubjectRelationship.Self), 'ivan', 'svc-fade'),
  seat(
    account('client-son', SubjectRelationship.Companion),
    'petar',
    'svc-fade',
  ),
  seat(anonymous('Мария'), 'stefan', 'svc-fade'),
  seat(anonymous('Мария'), 'stefan', 'svc-beard'),
];

/** The booker, two anonymous seats under ONE label, and a third guest under another. */
function sharedLabelVisit(
  arrangement: 'side_by_side' | 'back_to_back',
): readonly PrefillSeat[] {
  return [
    seat(account('client-1', SubjectRelationship.Self), 'ivan', 'svc-fade'),
    seat(anonymous('Walk-in'), 'stefan', 'svc-fade'),
    arrangement === 'side_by_side'
      ? seat(anonymous('Walk-in'), 'petar', 'svc-beard')
      : seat(anonymous('Walk-in'), 'stefan', 'svc-beard'),
    seat(anonymous('Мария'), 'ivan', 'svc-fade'),
  ];
}

/** The booker, and one guest under the name the visit stored — optionally with a companion first. */
function labelledGuestVisit(
  label: string,
  withCompanion = false,
): readonly PrefillSeat[] {
  return [
    seat(account('client-1', SubjectRelationship.Self), 'ivan', 'svc-fade'),
    ...(withCompanion
      ? [
          seat(
            account('client-son', SubjectRelationship.Companion),
            'petar',
            'svc-fade',
          ),
        ]
      : []),
    seat(anonymous(label), 'stefan', 'svc-fade'),
  ];
}

/** `rescheduleFrom` (a move) or `repeat` (a new booking), for a signed-in client-1. */
function prefilled(
  seats: readonly PrefillSeat[],
  companions: PrefillCompanions,
  partyOwner: UserId | null = CLIENT,
) {
  const reader = BookingCartSystem.readerOf(seats, partyOwner);
  const bag = BookingCartSystem.prefill(
    seats,
    reader,
    partyOwner,
    companions,
    guestLabel,
  );
  if (bag === null) throw new Error('bad fixture: nothing to prefill');
  return bag;
}

const guestLabels = (party: Party): readonly string[] =>
  Party.guests(party).map((guest) => guest.guestLabel);
const linesPerPerson = (cart: BookingCart): readonly number[] =>
  cart.cartSeats.map((entry) => entry.lines.length);

/** Every line at 12:00 with Ivan — the schedule step's hand-off to review. */
function assignmentsFor(cart: BookingCart): readonly SeatAssignment[] {
  return cart.cartSeats.flatMap((entry) =>
    entry.lines.map((l) => ({
      lineId: l.lineId,
      barberId: barber('ivan'),
      startMinutes: at(12),
      endMinutes: endMinute(mins(13)),
    })),
  );
}

describe('BookingCartSystem.toCommitSeats — the commit request', () => {
  it('sends WHAT and WHO, and never a price or a duration', () => {
    const withMaria = unwrapOk(Party.addGuest(Party.owned(CLIENT), 'Maria'));
    const guestId = (Party.guests(withMaria)[0] as PartyMember.Guest).guestId;
    const cart = added(
      added(BookingCart.empty(), SELF, line('svc-fade')),
      seatOf(guestId),
      line('svc-beard'),
    );

    const seats = BookingCartSystem.toCommitSeats(
      cart,
      withMaria,
      assignmentsFor(cart),
    );

    // One per seat — the guest travels too, as a LABEL.
    expect(seats).toHaveLength(2);
    // The guest's seat key rides beside the label.
    expect(seats?.map((entry) => entry.subject)).toEqual([
      { requestedSubjectRole: RequestedSubjectRole.Self },
      {
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Maria',
        guestKey: 'guest-0',
      },
    ]);
    const first = seats?.[0] as unknown as Record<string, unknown>;
    // The server resolves terms.
    expect(first['priceCents']).toBeUndefined();
    expect(first['durationMinutes']).toBeUndefined();
    expect(first['barberId']).toBe('ivan');
    // Its start is a minute of the selection's shop day.
    expect(first['startMinutes']).toBe(mins(12));
    expect(first['subject']).toEqual({
      requestedSubjectRole: RequestedSubjectRole.Self,
    });
    expect(first['barberPreference']).toBe(BarberPreference.Any);
  });
});

describe('BookingCartSystem.prefill — who a prefilled bag holds', () => {
  it('leaves a companion ACCOUNT out of a move — the server carries them, so no phantom guest', () => {
    const bag = prefilled(partyVisit, PrefillCompanions.CarriedByServer, null);

    // The father and Maria; the son is NOT re-created as a nameless guest.
    expect(Party.guests(bag.party)).toHaveLength(1);
    expect(linesPerPerson(bag.cart)).toEqual([1, 2]);
  });

  it('offers the companion as a guest on a repeat — a new booking cannot seat an account', () => {
    const bag = prefilled(partyVisit, PrefillCompanions.AsGuests, null);

    expect(Party.guests(bag.party)).toHaveLength(2);
    expect(linesPerPerson(bag.cart)).toEqual([1, 1, 2]);
  });

  it('keeps a guest with two services ONE person, as the server counts them', () => {
    const bag = prefilled(partyVisit, PrefillCompanions.CarriedByServer, null);

    // Under the name the visit stored for her, not a placeholder.
    expect(guestLabels(bag.party)).toEqual(['Мария']);
    expect(BookingCart.lineCount(bag.cart)).toBe(3);
  });

  it('keeps the name the SHOP gave a guest through a move, and sends it — never «Guest 1» over it', () => {
    const bag = prefilled(
      labelledGuestVisit('Иван (син)'),
      PrefillCompanions.CarriedByServer,
    );
    expect(guestLabels(bag.party)).toEqual(['Иван (син)']);

    const seats = BookingCartSystem.toCommitSeats(
      bag.cart,
      bag.party,
      assignmentsFor(bag.cart),
    );
    expect(
      (seats ?? []).flatMap((entry) =>
        entry.subject.requestedSubjectRole === RequestedSubjectRole.Guest
          ? [entry.subject.label]
          : [],
      ),
    ).toEqual(['Иван (син)']);
  });

  it('keeps the stored names on a repeat too, and numbers a nameless companion around them', () => {
    const bag = prefilled(
      labelledGuestVisit('Guest 1', true),
      PrefillCompanions.AsGuests,
    );

    expect(guestLabels(bag.party)).toEqual(['Guest 2', 'Guest 1']);
  });

  it('never hands a guest added later a name a prefilled guest already has', () => {
    const bag = prefilled(
      labelledGuestVisit('Guest 3'),
      PrefillCompanions.CarriedByServer,
    );
    const taken = guestLabels(bag.party);
    expect(BookingCartSystem.firstUnusedLabel(taken, guestLabel, 3)).toBe(
      'Guest 4',
    );
    expect(BookingCartSystem.firstUnusedLabel(taken, guestLabel, 1)).toBe(
      'Guest 1',
    );
  });

  it('sends the move without the companion — only the seats the cart can express', () => {
    const bag = prefilled(partyVisit, PrefillCompanions.CarriedByServer);
    const seats = BookingCartSystem.toCommitSeats(
      bag.cart,
      bag.party,
      assignmentsFor(bag.cart),
    );

    expect(
      seats?.map((entry) => entry.subject.requestedSubjectRole).sort(),
    ).toEqual(['GUEST', 'GUEST', 'SELF']);
  });

  for (const arrangement of ['side_by_side', 'back_to_back'] as const) {
    it(`reads two guests under ONE label as one person with both services — ${arrangement}, move and repeat alike`, () => {
      const moved = prefilled(
        sharedLabelVisit(arrangement),
        PrefillCompanions.CarriedByServer,
      );
      expect(Party.guests(moved.party)).toHaveLength(2);
      expect(linesPerPerson(moved.cart)).toEqual([1, 2, 1]);

      const repeated = prefilled(
        sharedLabelVisit(arrangement),
        PrefillCompanions.AsGuests,
      );
      expect(Party.guests(repeated.party)).toHaveLength(2);
      expect(linesPerPerson(repeated.cart)).toEqual([1, 2, 1]);
    });
  }

  it('sends both of that person’s seats under ONE label — the reading the server’s `personKey` agrees with', () => {
    const bag = prefilled(
      sharedLabelVisit('side_by_side'),
      PrefillCompanions.CarriedByServer,
    );
    const labels = (
      BookingCartSystem.toCommitSeats(
        bag.cart,
        bag.party,
        assignmentsFor(bag.cart),
      ) ?? []
    )
      .flatMap((entry) =>
        entry.subject.requestedSubjectRole === RequestedSubjectRole.Guest
          ? [entry.subject.label]
          : [],
      )
      .sort();
    expect(labels).toEqual(['Walk-in', 'Walk-in', 'Мария']);
  });

  it('keeps guests under DIFFERENT labels different people', () => {
    const bag = prefilled(
      sharedLabelVisit('back_to_back'),
      PrefillCompanions.AsGuests,
    );
    expect(guestLabels(bag.party)).toEqual(['Walk-in', 'Мария']);
  });
});

describe('BookingCartSystem.restore — a draft brought back to today', () => {
  it('resumes a draft holding two guests under one label on SERVICES, where one rename fixes it', () => {
    let party = Party.owned(CLIENT);
    party = unwrapOk(Party.addGuest(party, 'Maria'));
    party = unwrapOk(Party.addGuest(party, 'Ani'));
    let cart = added(BookingCart.empty(), SELF, line('svc-fade'));
    for (const guest of Party.guests(party)) {
      cart = added(cart, seatOf(guest.guestId), line('svc-fade'));
    }
    // A draft from before the rule: both guests answer to «Maria».
    const stale: Party = {
      ...party,
      members: party.members.map((member) =>
        member.partyRole === PartyRole.Guest
          ? PartyMember.guest(member.guestId, SeatLabel.of('Maria'))
          : member,
      ),
    };
    const draft = {
      state: {
        bookingFlowStep: BookingFlowStep.Schedule,
        party: stale,
        cart,
        locationId: null,
        when: FlexibleWhen.empty(),
      } as BookingFlowState,
      selectedLocalDate: null,
    };

    const restored = BookingCartSystem.restore(draft, DAY);
    // Not the grid: it would seat two people the server counts as one.
    expect(restored.state.bookingFlowStep).toBe(BookingFlowStep.Services);
    const limits = BookingPolicy.DEFAULT;
    const refused = BookingFlowSystem.next(
      restored.state,
      { bookingFlowEventKind: BookingFlowEventKind.Next },
      limits,
    );
    expect(!refused.ok && refused.error.errorCode).toBe(
      SchedulingErrorCode.PartyDuplicateLabel,
    );

    const second = Party.guests(stale)[1] as PartyMember.Guest;
    const renamed = unwrapOk(
      BookingFlowSystem.next(
        restored.state,
        {
          bookingFlowEventKind: BookingFlowEventKind.RenameGuest,
          guestId: second.guestId,
          label: 'Ani',
        },
        limits,
      ),
    );
    const moved = unwrapOk(
      BookingFlowSystem.next(
        renamed,
        { bookingFlowEventKind: BookingFlowEventKind.Next },
        limits,
      ),
    );
    expect(moved.bookingFlowStep).toBe(BookingFlowStep.Schedule);
  });

  it('resumes a review on the schedule, drops lapsed days and a lapsed pick', () => {
    const today = DAY;
    const cart = added(BookingCart.empty(), SELF, line('svc-fade'));
    const when = FlexibleWhen.of([
      DayWindows.wholeDay(localDate('2026-08-01')),
      DayWindows.of(localDate('2026-08-05'), [span(600, 720)]),
    ]);
    const onSchedule = BookingCartSystem.restore(
      {
        state: {
          bookingFlowStep: BookingFlowStep.Schedule,
          party: Party.owned(CLIENT),
          cart,
          locationId: CENTER,
          when,
        },
        selectedLocalDate: localDate('2026-08-02'),
      },
      today,
    );
    expect(onSchedule.state.bookingFlowStep).toBe(BookingFlowStep.Schedule);
    expect(
      onSchedule.state.bookingFlowStep === BookingFlowStep.Schedule &&
        FlexibleWhen.localDates(onSchedule.state.when),
    ).toEqual(['2026-08-05']);
    expect(onSchedule.selectedLocalDate).toBeNull();

    const fromReview = BookingCartSystem.restore(
      {
        state: {
          bookingFlowStep: BookingFlowStep.Review,
          party: Party.owned(CLIENT),
          cart,
          selection: {
            locationId: CENTER,
            localDate: today,
            startMinutes: at(12),
            endMinutes: endMinute(mins(13)),
            assignments: [],
          },
        },
        selectedLocalDate: today,
      },
      today,
    );
    expect(fromReview.state).toEqual({
      bookingFlowStep: BookingFlowStep.Schedule,
      party: Party.owned(CLIENT),
      cart,
      locationId: CENTER,
      when: FlexibleWhen.empty(),
    });
    expect(fromReview.selectedLocalDate).toBe(today);
  });
});

describe('BookingCartSystem.partyForCart — a waitlist landing, one label one guest', () => {
  const cart = unwrapOk(
    BookingCartSystem.salvage({
      cartSeats: ['self', 'guest-0', 'guest-1'].map((seatKey, index) => ({
        seatKey: SeatKeyText.of(seatKey),
        lines: [storedLine(seatKey, `line-${index}`, 'svc-fade')],
      })),
      cartNextSequence: 3,
    }),
  );

  it('names the guests as the catalogue numbers them', () => {
    const party = BookingCartSystem.partyForCart(cart, CLIENT, guestLabel);
    expect(party && guestLabels(party)).toEqual(['Guest 1', 'Guest 2']);
  });

  it('never hands two guests one placeholder, even from copy that drops the number', () => {
    const party = BookingCartSystem.partyForCart(cart, CLIENT, () => 'Гост');
    expect(party).not.toBeNull();
    expect(party && Party.sharedLabel(party)).toBeNull();
    expect(
      party &&
        BookingFlowState.is({
          bookingFlowStep: 'LOCATION',
          party,
          cart,
          locationId: null,
        }),
    ).toBe(true);
  });
});

describe('BookingCartSystem.firstUnusedLabel — the one placeholder rule', () => {
  const guest = (ordinal: number): string => `Гост ${ordinal}`;
  const first = (
    taken: readonly string[],
    label: (n: number) => string,
    from = 1,
  ) => BookingCartSystem.firstUnusedLabel(taken, label, from);

  it('counts up from `from`, stepping past every name in use', () => {
    expect(first([], guest)).toBe('Гост 1');
    expect(first(['Гост 1', 'Гост 2'], guest)).toBe('Гост 3');
    expect(first(['Гост 4'], guest, 4)).toBe('Гост 5');
    expect(first(['Мария'], guest, 2)).toBe('Гост 2');
  });

  it('matches the label a guest is stored under — trimmed, as `SeatLabel` keeps it', () => {
    expect(first(['Гост 1'], (n) => ` Гост ${n} `)).toBe('Гост 2');
  });

  it('numbers the word itself when the catalogue ignores the number — never a taken label', () => {
    expect(first([], () => 'Гост')).toBe('Гост');
    expect(first(['Гост'], () => 'Гост')).toBe('Гост 1');
    expect(first(['Гост', 'Гост 2'], () => 'Гост', 2)).toBe('Гост 3');
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
          const taken: readonly string[] = takenLabels;
          const label = ignoresNumber ? () => 'Гост' : guest;
          expect(taken.includes(first(taken, label, from))).toBe(false);
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
          const taken = takenOrdinals.map(guest);
          const label = first(taken, guest, from);
          expect(taken.includes(label)).toBe(false);
          const ordinal = Number(label.replace('Гост ', ''));
          expect(ordinal).toBeGreaterThanOrEqual(from);
          for (let earlier = from; earlier < ordinal; earlier++) {
            expect(taken.includes(guest(earlier))).toBe(true);
          }
        },
      ),
    );
  });
});

/* ── Purity ─────────────────────────────────────────────────────────── */

describe('BookingCartSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const cart = deepFreeze(
      added(
        added(BookingCart.empty(), SELF, line('svc-fade')),
        GUEST,
        line('svc-fade', 'niko'),
      ),
    );
    const services = deepFreeze([fadeService()]);
    const barbers = deepFreeze([
      barberDay('ivan', [mins(9), mins(12)]),
      barberDay('niko', [mins(9), mins(12)]),
    ]);
    const before = JSON.stringify([cart, services, barbers]);
    const ask = () =>
      optionsFor({
        cart,
        services,
        barbers,
        policy: policyWithLead(0),
        now: nowAt(6),
      });
    const once = ask();
    expect(ask()).toEqual(once);
    expect(once.length).toBeGreaterThan(0);
    const visit = deepFreeze(partyVisit);
    expect(
      BookingCartSystem.prefill(
        visit,
        CLIENT,
        CLIENT,
        PrefillCompanions.AsGuests,
        guestLabel,
      ),
    ).toEqual(
      BookingCartSystem.prefill(
        visit,
        CLIENT,
        CLIENT,
        PrefillCompanions.AsGuests,
        guestLabel,
      ),
    );
    expect(JSON.stringify([cart, services, barbers])).toBe(before);
  });

  it('every located option is at a shop serving the whole party, sorted by start then shop (property)', () => {
    const anyShop = fc.constantFrom('loc-center', 'loc-mladost');
    const window = fc
      .record({
        shop: anyShop,
        from: fc.integer({ min: 8, max: 15 }),
        hours: fc.integer({ min: 1, max: 4 }),
      })
      .map((w) => ({ ...w, to: Math.min(w.from + w.hours, 20) }));
    fc.assert(
      fc.property(
        fc.array(window, { minLength: 1, maxLength: 3 }),
        fc.array(window, { minLength: 1, maxLength: 3 }),
        fc.constantFrom('svc-cut', 'svc-beard'),
        (ivan, niko, serviceId) => {
          const barbers: CartBarberDay[] = [
            ['ivan', ivan] as const,
            ['niko', niko] as const,
          ].map(([id, windows]) => ({
            barberId: barber(id),
            windows: MinuteRange.normalize(
              windows
                .filter((w) => w.shop === 'loc-center')
                .map((w) => span(mins(w.from), mins(w.to))),
            )
              .map((r) =>
                rosterWindow(id, CENTER, r.startMinutes, r.endMinutes),
              )
              .concat(
                MinuteRange.normalize(
                  windows
                    .filter((w) => w.shop === 'loc-mladost')
                    .map((w) => span(mins(w.from), mins(w.to))),
                ).map((r) =>
                  rosterWindow(id, MLADOST, r.startMinutes, r.endMinutes),
                ),
              ),
            busy: [],
          }));
          const cart = added(BookingCart.empty(), SELF, line(serviceId));
          const services = [
            serviceAt('svc-cut', []),
            serviceAt('svc-beard', ['loc-center']),
          ];
          const options = optionsFor({
            cart,
            services,
            barbers,
            policy: policyWithLead(0),
            now: nowAt(6),
          });
          let previous: (typeof options)[number] | null = null;
          for (const entry of options) {
            if (serviceId === 'svc-beard')
              expect(entry.locationId).toBe('loc-center');
            if (previous !== null) {
              const order =
                previous.option.startMinutes - entry.option.startMinutes ||
                (previous.locationId < entry.locationId
                  ? -1
                  : previous.locationId > entry.locationId
                    ? 1
                    : 0);
              expect(order).toBeLessThanOrEqual(0);
            }
            previous = entry;
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('BookingCartSystem — edges', () => {
  const stored = (seatKey: string, lineId: string, serviceId: string) =>
    storedLine(seatKey, lineId, serviceId);

  it('keeps a seat listed twice at its first place with its last non-empty lines', () => {
    const restored = unwrapOk(
      BookingCartSystem.salvage({
        cartSeats: [
          { seatKey: SELF, lines: [stored('self', 'line-0', 'svc-a')] },
          { seatKey: GUEST, lines: [stored('guest-0', 'line-1', 'svc-b')] },
          { seatKey: SELF, lines: [stored('wrong', 'line-2', 'svc-c')] },
          { seatKey: GUEST, lines: [stored('guest-0', 'line-3', '')] },
        ],
        cartNextSequence: 4,
      }),
    );
    expect(restored.cartSeats.map((seat) => seat.seatKey)).toEqual([
      'self',
      'guest-0',
    ]);
    // The later `self` replaces the earlier, and names its own seat.
    expect(BookingCart.linesFor(restored, SELF)).toEqual([
      stored('self', 'line-2', 'svc-c'),
    ]);
    // An emptied later entry leaves the earlier alone.
    expect(BookingCart.linesFor(restored, GUEST)).toHaveLength(1);
  });

  it('refuses a commit naming a line the cart lost, or a seat that is nobody’s', () => {
    const cart = added(BookingCart.empty(), SELF, line('svc-fade'));
    const lost: SeatAssignment = {
      lineId: CartLineId.of('line-99'),
      barberId: barber('ivan'),
      startMinutes: at(12),
      endMinutes: endMinute(mins(13)),
    };
    expect(
      BookingCartSystem.toCommitSeats(cart, Party.owned(CLIENT), [lost]),
    ).toBeNull();
    const stranger = added(
      BookingCart.empty(),
      SeatKeyText.of('guest-7'),
      line('svc-fade'),
    );
    expect(
      BookingCartSystem.toCommitSeats(
        stranger,
        Party.owned(CLIENT),
        assignmentsFor(stranger),
      ),
    ).toBeNull();
  });

  it('reads nobody off a visit with no `self` seat and no claimed owner', () => {
    expect(
      BookingCartSystem.readerOf(
        [seat(anonymous('Мария'), 'ivan', 'svc-fade')],
        null,
      ),
    ).toBeNull();
    expect(BookingCartSystem.readerOf(partyVisit, null)).toBe('client-1');
  });

  it('rebuilds nothing from a visit the server carries whole, or under a placeholder that is no label', () => {
    const onlySon = [
      seat(
        account('client-son', SubjectRelationship.Companion),
        'petar',
        'svc-beard',
      ),
    ];
    expect(
      BookingCartSystem.prefill(
        onlySon,
        CLIENT,
        CLIENT,
        PrefillCompanions.CarriedByServer,
        guestLabel,
      ),
    ).toBeNull();
    expect(
      BookingCartSystem.prefill(
        onlySon,
        CLIENT,
        CLIENT,
        PrefillCompanions.AsGuests,
        () => '   ',
      ),
    ).toBeNull();
    const cart = added(BookingCart.empty(), GUEST, line('svc-fade'));
    expect(BookingCartSystem.partyForCart(cart, CLIENT, () => ' ')).toBeNull();
  });

  it('resumes a location draft as it was, and a terminal one on services', () => {
    const cart = added(BookingCart.empty(), SELF, line('svc-fade'));
    const location = BookingFlowState.initial(Party.owned(CLIENT));
    expect(
      BookingCartSystem.restore(
        { state: location, selectedLocalDate: null },
        DAY,
      ).state,
    ).toBe(location);
    const selection = {
      locationId: CENTER,
      localDate: DAY,
      startMinutes: at(12),
      endMinutes: endMinute(mins(13)),
      assignments: [],
    };
    const terminals: readonly BookingFlowState[] = [
      {
        bookingFlowStep: BookingFlowStep.Confirmed,
        confirmation: {
          appointmentId: AppointmentId.of('appt-1'),
          party: Party.owned(CLIENT),
          cart,
          selection,
        },
      },
      {
        bookingFlowStep: BookingFlowStep.Waitlisted,
        summary: {
          requestId: WaitlistRequestId.of('wl-1'),
          party: Party.owned(CLIENT),
          cart,
          when: FlexibleWhen.empty(),
          locationId: CENTER,
        },
      },
    ];
    for (const terminal of terminals) {
      expect(
        BookingCartSystem.restore(
          { state: terminal, selectedLocalDate: null },
          DAY,
        ).state,
      ).toEqual({
        bookingFlowStep: BookingFlowStep.Services,
        party: Party.owned(CLIENT),
        cart,
        locationId: CENTER,
      });
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Pass C (W0-D): the booking feature's decisions, homed here — the review's
 * booker-first order, the services step's next empty seat, the schedule
 * step's shop coverage, the time sheet's arrangement and the booking grid's
 * day (moved from `features/client/booking` `day-availability.ts`; its
 * spec's cases restated on the system).
 * ═════════════════════════════════════════════════════════════════════ */

describe('BookingCartSystem.bookerFirst — the review pins the booker to the front', () => {
  const MARIA = SeatKeyText.of('guest-0');
  const ANI = SeatKeyText.of('guest-1');

  it('moves the booker to the front and keeps every other seat in cart order', () => {
    expect(BookingCartSystem.bookerFirst([MARIA, SELF, ANI])).toEqual([
      SELF,
      MARIA,
      ANI,
    ]);
    expect(BookingCartSystem.bookerFirst([ANI, MARIA, SELF])).toEqual([
      SELF,
      ANI,
      MARIA,
    ]);
  });

  it('leaves an order with the booker first, without the booker, or empty as it is', () => {
    expect(BookingCartSystem.bookerFirst([SELF, ANI, MARIA])).toEqual([
      SELF,
      ANI,
      MARIA,
    ]);
    expect(BookingCartSystem.bookerFirst([ANI, MARIA])).toEqual([ANI, MARIA]);
    expect(BookingCartSystem.bookerFirst([])).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const keys = deepFreeze([MARIA, SELF, ANI]);
    expect(BookingCartSystem.bookerFirst(keys)).toEqual(
      BookingCartSystem.bookerFirst(keys),
    );
  });
});

describe('BookingCartSystem.nextSeatWithoutService — the services step’s forward move', () => {
  const CLIENT = UserId.of('user-client');
  /** The booker and guests Maria (guest-0) and Ani (guest-1). */
  const party = (): Party => {
    let built = Party.owned(CLIENT);
    built = unwrapOk(Party.addGuest(built, 'Maria'));
    return unwrapOk(Party.addGuest(built, 'Ani'));
  };
  const MARIA = seatOf(GuestId.of('guest-0'));
  const ANI = seatOf(GuestId.of('guest-1'));
  const next = BookingCartSystem.nextSeatWithoutService;

  it('hands over to the next empty seat AFTER the active one, wrapping past the end', () => {
    const selfHolds = added(BookingCart.empty(), SELF, line('svc-cut'));
    expect(next(party(), selfHolds, SELF)).toBe(MARIA);
    expect(next(party(), selfHolds, MARIA)).toBe(ANI);
    // From Ani the walk wraps: the booker holds something, Maria is next.
    expect(next(party(), selfHolds, ANI)).toBe(MARIA);
  });

  it('counts the ACTIVE seat as the last candidate — the person on screen can be the empty one', () => {
    const othersHold = added(
      added(BookingCart.empty(), SELF, line('svc-cut')),
      ANI,
      line('svc-cut'),
    );
    expect(next(party(), othersHold, MARIA)).toBe(MARIA);
  });

  it('is null when everyone holds something, and with fewer than two seats', () => {
    const everyone = added(
      added(
        added(BookingCart.empty(), SELF, line('svc-cut')),
        MARIA,
        line('svc-cut'),
      ),
      ANI,
      line('svc-cut'),
    );
    expect(next(party(), everyone, SELF)).toBeNull();
    expect(next(Party.owned(CLIENT), BookingCart.empty(), SELF)).toBeNull();
    expect(next(null, null, SELF)).toBeNull();
  });

  it('holds nothing for anyone without a cart, and starts from the booker for an unknown seat', () => {
    expect(next(party(), null, SELF)).toBe(MARIA);
    expect(next(party(), BookingCart.empty(), SeatKeyText.of('guest-9'))).toBe(
      SELF,
    );
  });

  it('walks the services step’s row only — a companion has no seat there', () => {
    const withCompanion: Party = {
      ...party(),
      members: [
        ...party().members,
        PartyMember.companion(UserId.of('user-son')),
      ],
    };
    const guestsHold = added(
      added(BookingCart.empty(), MARIA, line('svc-cut')),
      ANI,
      line('svc-cut'),
    );
    expect(next(withCompanion, guestsHold, MARIA)).toBe(SELF);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozenParty = deepFreeze(party());
    const cart = deepFreeze(added(BookingCart.empty(), SELF, line('svc-cut')));
    expect(next(frozenParty, cart, SELF)).toEqual(
      next(frozenParty, cart, SELF),
    );
  });
});

describe('BookingCartSystem.shopCoverage — can the chosen shop serve the visit?', () => {
  const coverage = BookingCartSystem.shopCoverage;
  const SERVED = { shopCoverage: ShopCoverage.Served, targetId: null };
  const NOWHERE = { shopCoverage: ShopCoverage.Nowhere, targetId: null };

  it('is served while the serving shops are unknown', () => {
    expect(coverage(null, MLADOST, true)).toEqual(SERVED);
    expect(coverage(null, null, true)).toEqual(SERVED);
  });

  it('under “any shop”, is served whenever one active shop can, else nowhere', () => {
    expect(coverage([CENTER], null, false)).toEqual(SERVED);
    expect(coverage([], null, false)).toEqual(NOWHERE);
  });

  it('says nothing at a shop that serves the visit', () => {
    expect(coverage([CENTER, MLADOST], MLADOST, true)).toEqual(SERVED);
  });

  it('counts a chosen shop that is not on the active list as served — not this question’s to answer', () => {
    expect(coverage([CENTER], MLADOST, false)).toEqual(SERVED);
    expect(coverage([], MLADOST, false)).toEqual(SERVED);
  });

  it('names the ONE shop that serves the visit when the chosen one does not', () => {
    expect(coverage([CENTER], MLADOST, true)).toEqual({
      shopCoverage: ShopCoverage.Elsewhere,
      targetId: CENTER,
    });
  });

  it('points at “any shop” when several others can', () => {
    const third = shop('loc-third');
    expect(coverage([CENTER, third], MLADOST, true)).toEqual({
      shopCoverage: ShopCoverage.Elsewhere,
      targetId: null,
    });
  });

  it('sends the visit back to its services when no active shop offers all of it', () => {
    expect(coverage([], MLADOST, true)).toEqual(NOWHERE);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const serving = deepFreeze([CENTER]);
    expect(coverage(serving, MLADOST, true)).toEqual(
      coverage(serving, MLADOST, true),
    );
  });
});

describe('BookingCartSystem.arrangementOf — all at once, or one after another', () => {
  const starting = (...minutes: number[]) =>
    minutes.map((m) => ({ startMinutes: minute(m) }));

  it('reads one seat, and none, as side by side', () => {
    expect(BookingCartSystem.arrangementOf(starting(600))).toBe(
      SeatArrangement.Parallel,
    );
    expect(BookingCartSystem.arrangementOf([])).toBe(SeatArrangement.Parallel);
  });

  it('reads every seat at the first one’s minute as parallel', () => {
    expect(BookingCartSystem.arrangementOf(starting(600, 600, 600))).toBe(
      SeatArrangement.Parallel,
    );
  });

  it('reads any seat at another minute as sequential, wherever it sits', () => {
    expect(BookingCartSystem.arrangementOf(starting(600, 630))).toBe(
      SeatArrangement.Sequential,
    );
    expect(BookingCartSystem.arrangementOf(starting(600, 600, 540))).toBe(
      SeatArrangement.Sequential,
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const assignments = deepFreeze(starting(600, 630));
    expect(BookingCartSystem.arrangementOf(assignments)).toBe(
      BookingCartSystem.arrangementOf(assignments),
    );
  });
});

describe('BookingCartSystem — one shop day’s grid from its raw documents', () => {
  const IVAN = barberScheduleFixture().id;
  const NIKO = barber('b-niko');
  const HOME = locationFixture().id;
  /** A Tuesday — the fixture roster works it; the day after the pinned "today". */
  const TUESDAY = localDate('2026-09-29');
  const CUT_CART = added(
    BookingCart.empty(),
    SELF,
    line(serviceFixture().id as string),
  );

  function query(change: Partial<DayQuery> = {}): DayQuery {
    return {
      cart: CUT_CART,
      services: [serviceFixture()],
      barberIds: [IVAN],
      locationId: null,
      localDate: TUESDAY,
      policy: BookingPolicy.DEFAULT,
      now: FIXTURE_NOW,
      riders: [],
      release: [],
      releaseLocalDate: null,
      shops: [locationFixture()],
      ...change,
    };
  }

  function docs(
    day: {
      readonly schedule?: DayDocs['barbers'][number]['schedule'];
      readonly busy?: DayDocs['barbers'][number]['busy'];
      readonly exception?: DayDocs['barbers'][number]['exception'];
      readonly namedLocation?: DayDocs['namedLocation'];
    } = {},
  ): DayDocs {
    return {
      key: BookingCartSystem.dayDocsKey(query()),
      barbers: [
        {
          barberId: IVAN,
          schedule:
            day.schedule === undefined ? barberScheduleFixture() : day.schedule,
          busy: day.busy ?? null,
          exception: day.exception ?? null,
        },
      ],
      namedLocation: day.namedLocation ?? null,
    };
  }

  const heldChair = (from: number, to: number): ChairTime => ({
    barberId: IVAN,
    startMinutes: minute(from),
    endMinutes: endMinute(to),
  });
  const busyOn = (from: number, to: number) =>
    barberBusyDayFixture({
      localDate: TUESDAY,
      blocks: [MinuteBlock.of(minute(from), endMinute(to), BlockKind.Busy)],
    });
  /** The same shop, open 10:00–17:00 every day. */
  const shortHours = (status: LocationStatus = LocationStatus.Active) =>
    locationFixture({
      locationStatus: status,
      openingHours: Array.from({ length: 7 }, () =>
        DayHours.open(minute(600), endMinute(1020)),
      ),
    });
  const starts = (q: DayQuery, d: DayDocs) =>
    BookingCartSystem.dayOptions(q, d).map(
      (entry) => entry.option.startMinutes,
    );

  describe('dayDocsKey / sameDayDocsKey — which documents a day reads', () => {
    it('lists the barbers in code-unit order, whatever order they came in', () => {
      expect(
        BookingCartSystem.dayDocsKey(query({ barberIds: [NIKO, IVAN] }))
          .barberIds,
      ).toEqual([IVAN, NIKO]);
    });

    it('reads a shop by id only for a MOVE at a named shop — a chosen shop alone reads nothing more', () => {
      expect(
        BookingCartSystem.dayDocsKey(query({ locationId: HOME }))
          .namedLocationId,
      ).toBeNull();
      expect(
        BookingCartSystem.dayDocsKey(
          query({
            locationId: HOME,
            release: [heldChair(600, 630)],
            releaseLocalDate: TUESDAY,
          }),
        ).namedLocationId,
      ).toBe(HOME);
      expect(
        BookingCartSystem.dayDocsKey(
          query({ release: [heldChair(600, 630)], releaseLocalDate: TUESDAY }),
        ).namedLocationId,
      ).toBeNull();
    });

    it('holds two fresh keys for the same documents equal, in any barber order, and tells every field apart', () => {
      const key = (change: Partial<DayQuery> = {}) =>
        BookingCartSystem.dayDocsKey(query(change));
      expect(BookingCartSystem.sameDayDocsKey(key(), key())).toBe(true);
      expect(
        BookingCartSystem.sameDayDocsKey(
          key({ barberIds: [IVAN, NIKO] }),
          key({ barberIds: [NIKO, IVAN] }),
        ),
      ).toBe(true);
      expect(
        BookingCartSystem.sameDayDocsKey(
          key(),
          key({ localDate: localDate('2026-09-30') }),
        ),
      ).toBe(false);
      expect(
        BookingCartSystem.sameDayDocsKey(
          key(),
          key({ barberIds: [IVAN, NIKO] }),
        ),
      ).toBe(false);
      expect(
        BookingCartSystem.sameDayDocsKey(
          key(),
          key({
            locationId: HOME,
            release: [heldChair(600, 630)],
            releaseLocalDate: TUESDAY,
          }),
        ),
      ).toBe(false);
    });

    it('equals `null` only to `null`', () => {
      const key = BookingCartSystem.dayDocsKey(query());
      expect(BookingCartSystem.sameDayDocsKey(null, null)).toBe(true);
      expect(BookingCartSystem.sameDayDocsKey(null, key)).toBe(false);
      expect(BookingCartSystem.sameDayDocsKey(key, null)).toBe(false);
    });
  });

  describe('barberDays / dayOptions — the systems over the documents', () => {
    it('offers every step of a rostered barber’s free day, from the day’s first minute', () => {
      const offered = starts(query(), docs());
      expect(offered[0]).toBe(9 * 60);
      expect(offered.at(-1)).toBe(17 * 60 + 30);
      expect(offered).toHaveLength(35);
    });

    it('keeps out what is taken, padded by the turnaround', () => {
      const padded = barberScheduleFixture({
        turnaroundMinutes: minuteCount(15),
      });
      const offered = starts(
        query(),
        docs({ schedule: padded, busy: busyOn(600, 630) }),
      );
      expect(offered).toContain(9 * 60 + 15);
      expect(offered).not.toContain(9 * 60 + 30);
      expect(offered).not.toContain(10 * 60 + 30);
      expect(offered).toContain(10 * 60 + 45);
    });

    it('hands a moved visit’s own chairs back on its own day only', () => {
      const own = query({
        release: [heldChair(600, 630)],
        releaseLocalDate: TUESDAY,
      });
      expect(starts(own, docs({ busy: busyOn(600, 630) }))).toContain(10 * 60);
      const other = query({
        release: [heldChair(600, 630)],
        releaseLocalDate: localDate('2026-09-30'),
      });
      expect(starts(other, docs({ busy: busyOn(600, 630) }))).not.toContain(
        10 * 60,
      );
    });

    it('offers nothing on a day the exception closes, without a roster, or at no listed shop', () => {
      expect(
        starts(
          query(),
          docs({ exception: scheduleExceptionFixture({ localDate: TUESDAY }) }),
        ),
      ).toEqual([]);
      expect(starts(query(), docs({ schedule: null }))).toEqual([]);
      expect(
        starts(
          query({
            shops: [locationFixture({ locationStatus: LocationStatus.Hidden })],
          }),
          docs(),
        ),
      ).toEqual([]);
      expect(
        BookingCartSystem.barberDays(query({ shops: [] }), docs()),
      ).toEqual([]);
    });

    it('offers a move’s UNLISTED named shop, clamped to its own hours', () => {
      const move = query({ locationId: HOME, shops: [] });
      const days = BookingCartSystem.barberDays(
        move,
        docs({ namedLocation: shortHours(LocationStatus.Hidden) }),
      );
      expect(days).toHaveLength(1);
      expect(days[0]?.windows).toEqual([
        RosterWindow.of(IVAN, HOME, minute(600), endMinute(1020)),
      ]);
    });

    it('REPLACES a listed shop by the move’s named copy — its own hours, never doubled', () => {
      const move = query({ locationId: null, shops: [locationFixture()] });
      const days = BookingCartSystem.barberDays(
        move,
        docs({ namedLocation: shortHours() }),
      );
      expect(days[0]?.windows).toEqual([
        RosterWindow.of(IVAN, HOME, minute(600), endMinute(1020)),
      ]);
    });

    it('narrows to the chosen shop — a barber with no window there is not on the day', () => {
      const elsewhere = shop('loc-mladost');
      const shops = [locationFixture(), locationFixture({ id: elsewhere })];
      expect(
        BookingCartSystem.barberDays(
          query({ shops, locationId: elsewhere }),
          docs(),
        ),
      ).toEqual([]);
      expect(
        BookingCartSystem.barberDays(
          query({ shops, locationId: HOME }),
          docs(),
        ),
      ).toHaveLength(1);
    });

    it('floors today at now plus the lead time', () => {
      const today = query({ localDate: localDate('2026-09-28') });
      expect(starts(today, docs())[0]).toBe(11 * 60);
    });

    it('is pure: same input → same output, inputs untouched', () => {
      const q = deepFreeze(
        query({ release: [heldChair(600, 630)], releaseLocalDate: TUESDAY }),
      );
      const d = deepFreeze(docs({ busy: busyOn(600, 630) }));
      expect(BookingCartSystem.dayOptions(q, d)).toEqual(
        BookingCartSystem.dayOptions(q, d),
      );
      expect(BookingCartSystem.barberDays(q, d)).toEqual(
        BookingCartSystem.barberDays(q, d),
      );
    });
  });
});
