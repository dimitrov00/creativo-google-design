import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { LocationId, Service } from '@creativo/domain/catalog';
import { BookingCart, BookingPolicy } from '@creativo/domain/scheduling';
import { toShop } from '../adapters/firestore-booking-store';
import { cartAdmissible, shopListed } from './party-admission';
import {
  type BookingSnapshot,
  type RequestedSeat,
  decideBooking,
} from './decide-booking';

/*
 * ONE RULE FOR "THE COMMIT REFUSES THIS WHATEVER THE TIME" (round 6). The
 * waitlist admits a cart through `cartAdmissible`; the commit decides the
 * same party through `decideBooking`. Both ask `partyAdmissible`, so they
 * can never disagree about it — which this pins as a property: over random
 * carts, caps, shops and catalogues, the waitlist refuses a cart exactly
 * when the commit refuses the same party for one of those reasons, with the
 * same code. A second copy of any check on either side breaks it.
 */

const ZONE = 'Europe/Sofia';
const CENTER = 'loc-center';
const MLADOST = 'loc-mladost';
const now = unwrap(
  ZonedDateTime.fromISO('2030-01-13T08:00:00.000+02:00', ZONE),
);

/** The refusals that do not depend on the time — `partyAdmissible`'s. */
const ADMISSION = new Set([
  'booking.commit.party_too_large',
  'booking.commit.unknown_service',
  'booking.commit.service_not_at_location',
  'booking.commit.invalid_input',
  'booking.commit.conflicting_services',
]);

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function service(
  id: string,
  overrides: {
    readonly locationIds?: readonly string[];
    readonly conflictsWith?: readonly string[];
    readonly variants?: readonly string[];
  } = {},
): Service {
  return unwrap(
    Service.create({
      id,
      name: { bg: id, en: id },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2500,
      currencyCode: 'EUR',
      durationMinutes: 30,
      locationIds: overrides.locationIds ?? [],
      conflictsWith: overrides.conflictsWith ?? [],
      variants: (overrides.variants ?? []).map((variant) => ({
        id: variant,
        name: { bg: variant, en: variant },
      })),
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

const CATALOGUE: readonly Service[] = [
  service('svc-cut'),
  service('svc-royal', { locationIds: [CENTER] }),
  service('svc-beard', { conflictsWith: ['svc-shave'] }),
  service('svc-shave'),
  service('svc-color', { variants: ['short', 'long'] }),
];

function policyOf(maxPartySize: number): BookingPolicy {
  return unwrap(
    BookingPolicy.create({
      maxPartySize,
      slotStepMinutes: 15,
      minLeadMinutes: 120,
      horizonMonths: 2,
      cancellationWindowHours: 24,
      maxFlexibleDays: 7,
      autoConfirm: true,
    }),
  );
}

const lineArb = fc.record({
  serviceId: fc.constantFrom(
    'svc-cut',
    'svc-royal',
    'svc-beard',
    'svc-shave',
    'svc-color',
    'svc-retired',
  ),
  variantId: fc.constantFrom<string | null>(null, 'short', 'medium'),
});

const cartArb = fc.array(fc.array(lineArb, { minLength: 1, maxLength: 2 }), {
  minLength: 1,
  maxLength: 3,
});

describe('cartAdmissible — the waitlist and the commit admit a party by one rule', () => {
  it('refuses a cart exactly when the commit refuses the same party whatever the time (property)', () => {
    fc.assert(
      fc.property(
        cartArb,
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom(CENTER, MLADOST),
        (seats, cap, shop) => {
          const policy = policyOf(cap);
          let sequence = 0;
          const props = {
            seats: seats.map((lines, index) => ({
              seatKey: index === 0 ? 'self' : `guest-${index}`,
              lines: lines.map((line) => ({
                id: `line-${sequence++}`,
                serviceId: line.serviceId,
                variantId: line.variantId,
                barberId: null,
              })),
            })),
            nextSequence: sequence,
          };
          const cart = unwrap(BookingCart.reconstitute(props));

          const waitlist = cartAdmissible(
            cart,
            CATALOGUE,
            policy,
            unwrap(LocationId.create(shop)),
          );

          const requested = props.seats.flatMap((seat) =>
            seat.lines.map((line): RequestedSeat => ({
              lineId: line.id,
              serviceId: line.serviceId,
              variantId: line.variantId,
              barberId: 'ivan',
              startIso: '2030-01-15T10:00:00.000+02:00',
              subject:
                seat.seatKey === 'self'
                  ? { kind: 'self' }
                  : {
                      kind: 'guest',
                      label: seat.seatKey,
                      guestKey: seat.seatKey,
                    },
            })),
          );
          const snapshot: BookingSnapshot = {
            zone: ZONE,
            shopHours: [],
            services: CATALOGUE,
            schedules: new Map(),
            busy: new Map(),
            exceptions: new Map(),
          };
          const commit = decideBooking(
            { locationId: shop, seats: requested },
            snapshot,
            { now, policy, nextId: () => 'seat', ownerUserId: 'user-1' },
          );
          // Anything past admission (no roster here) is the commit's
          // time-dependent answer, and none of the waitlist's business.
          const commitAdmission =
            commit.isFailure() && ADMISSION.has(commit.error.code)
              ? commit.error.code
              : null;

          expect(waitlist.isFailure() ? waitlist.error.code : null).toBe(
            commitAdmission,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

/*
 * THE SHOP A WAITLIST MAY WATCH (team decision, 2026-09-26): a location
 * document read the way the commit reads it (`toShop`), then judged by the
 * one rule the waitlist's door and the matcher's day both ask
 * (`shopListed`). Only a shop that is there AND `active` is listed. A
 * missing document, `hidden`, a status the domain does not know
 * (`archived`) and no status at all are each refused: fail-closed, as every
 * public query (`where('status', '==', 'active')`) already reads them.
 */
describe('shopListed — the shop a waitlist may watch, as the booking path reads it', () => {
  const hours = Array.from({ length: 7 }, () => ({
    kind: 'open',
    opens: '08:00',
    closes: '20:00',
  }));

  it.each([
    ['there and active', true, { timezone: ZONE, status: 'active', hours }],
    ['hidden', false, { timezone: ZONE, status: 'hidden', hours }],
    [
      'a status nobody modelled',
      false,
      { timezone: ZONE, status: 'archived', hours },
    ],
    ['no status at all', false, { timezone: ZONE, hours }],
    ['not there', false, undefined],
  ] as const)('%s → listed: %s', (_label, listed, document) => {
    expect(shopListed(toShop(document))).toBe(listed);
  });

  it('reads the shop the commit reads — its own zone and hours, or the defaults', () => {
    expect(
      toShop({ timezone: 'Europe/Athens', status: 'active', hours }),
    ).toEqual({ zone: 'Europe/Athens', hours, active: true });
    // A document without a zone or hours reads as the tenant's zone and a
    // shop that publishes no hours — what the commit clamped by before the
    // reading was shared.
    expect(toShop({ status: 'hidden' })).toEqual({
      zone: 'Europe/Sofia',
      hours: [],
      active: false,
    });
    expect(toShop(undefined)).toBeNull();
  });
});
