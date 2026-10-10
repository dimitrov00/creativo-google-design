import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy } from '../components/booking-policy.data';
import type { BookingCart } from '../components/cart-line.data';
import { LocationState } from '../components/catalog-status.data';
import { PlacementPolicy } from '../components/placement-policy.data';
import {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import { LocationId } from '../entities/location.entity';
import { type ServiceEntity, ServiceId } from '../entities/service.entity';
import {
  dayTableFixture,
  deepFreeze,
  locationFixture,
  serviceFixture,
  textFixture,
  unwrapOk,
} from '../testing';
import {
  BookingDecisionSystem,
  type RequestedSeat,
} from './booking-decision.system';
import { PartyAdmissionSystem } from './party-admission.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of apps/functions/src/use-cases/party-admission.spec.ts (7),
 * COPIED: ONE RULE FOR "THE COMMIT REFUSES THIS WHATEVER THE TIME". The
 * waitlist admits a cart through `admitCart`; the commit decides the same
 * party through `BookingDecisionSystem.decide`; both ask `admit`, so over
 * random carts, caps, shops and catalogues they refuse together, with the
 * same code. `toShop` (the functions' document reader) stays with its
 * adapter; here the shop is the stored `status`.
 */

const ZONE = 'Europe/Sofia';
const CENTER = 'loc-center';
const MLADOST = 'loc-mladost';
const DAYS = dayTableFixture('2030-01-10', '2030-03-31', ZONE);
const NOW_MS = Date.UTC(2030, 0, 13, 6, 0);

/** The refusals that do not depend on the time — `admit`'s. */
const ADMISSION = new Set([
  'booking.commit.party_too_large',
  'booking.commit.unknown_service',
  'booking.commit.service_not_at_location',
  'booking.commit.invalid_input',
  'booking.commit.conflicting_services',
]);

function service(
  id: string,
  overrides: {
    readonly locationIds?: readonly string[];
    readonly conflictsWith?: readonly string[];
    readonly variants?: readonly string[];
  } = {},
): ServiceEntity {
  return serviceFixture({
    id: ServiceId.of(id),
    baseTerms: ServiceTerms.unpadded(2500, 'EUR', 30),
    locationIds: (overrides.locationIds ?? []).map(LocationId.of),
    conflictsWith: (overrides.conflictsWith ?? []).map(ServiceId.of),
    variants: (overrides.variants ?? []).map((variant) => ({
      id: ServiceVariantId.of(variant),
      name: textFixture(variant),
    })),
    offerings: [],
  });
}

const CATALOGUE: readonly ServiceEntity[] = [
  service('svc-cut'),
  service('svc-royal', { locationIds: [CENTER] }),
  service('svc-beard', { conflictsWith: ['svc-shave'] }),
  service('svc-shave'),
  service('svc-color', { variants: ['short', 'long'] }),
];

function policyOf(maxPartySize: number): BookingPolicy {
  return unwrapOk(
    BookingPolicy.create({ ...BookingPolicy.DEFAULT, maxPartySize }),
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

describe('admitCart — the waitlist and the commit admit a party by one rule', () => {
  it('refuses a cart exactly when the commit refuses the same party whatever the time (property)', () => {
    fc.assert(
      fc.property(
        cartArb,
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom(CENTER, MLADOST),
        (seats, cap, shop) => {
          const policy = policyOf(cap);
          let sequence = 0;
          const cart: BookingCart = {
            seats: seats.map((lines, index) => {
              const seatKey = index === 0 ? 'self' : `guest-${index}`;
              return {
                seatKey,
                lines: lines.map((line) => ({
                  lineId: `line-${sequence++}`,
                  seatKey,
                  serviceId: ServiceId.of(line.serviceId),
                  variantId:
                    line.variantId === null
                      ? null
                      : ServiceVariantId.of(line.variantId),
                  barberId: null,
                  locationId: null,
                })),
              };
            }),
            nextSequence: sequence,
          };

          const waitlist = PartyAdmissionSystem.admitCart(
            cart,
            CATALOGUE,
            policy,
            LocationId.of(shop),
          );

          const requested = cart.seats.flatMap((seat) =>
            seat.lines.map((line): RequestedSeat => ({
              lineId: line.lineId,
              serviceId: line.serviceId,
              variantId: line.variantId,
              barberId: 'ivan',
              barberPref: null,
              startMs: NOW_MS + 2 * 86_400_000,
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
          const commit = BookingDecisionSystem.decide(
            {
              locationId: shop,
              seats: requested,
              attemptId: null,
              bookedFromAppointmentId: null,
              contact: null,
              placement: null,
            },
            {
              zone: ZONE,
              shopHours: [],
              services: CATALOGUE,
              schedules: [],
              busy: [],
              exceptions: [],
            },
            policy,
            PlacementPolicy.clientDefault(),
            [],
            {
              nowMs: NOW_MS,
              nextId: () => 'seat',
              days: DAYS,
              ownerUserId: 'user-1',
              termsOverrides: [],
              standing: [],
              stood: [],
              parsePhone: () => null,
            },
          );
          // Anything past admission (no roster here) is the commit's
          // time-dependent answer, and none of the waitlist's business.
          const commitAdmission =
            !commit.ok && ADMISSION.has(commit.error.code)
              ? commit.error.code
              : null;

          expect(waitlist.ok ? null : waitlist.error.code).toBe(
            commitAdmission,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

/*
 * THE SHOP A WAITLIST MAY WATCH (team decision, 2026-09-26): only a shop
 * that is there AND `active` is listed. A missing document, `hidden`, a
 * status the domain does not know (`archived`) and no status at all are
 * each refused: fail-closed.
 */
describe('shopListed — the shop a waitlist may watch', () => {
  it.each([
    ['there and active', true, { status: LocationState.Active }],
    ['hidden', false, { status: LocationState.Hidden }],
    [
      'a status nobody modelled',
      false,
      { status: 'archived' as LocationState },
    ],
    [
      'no status at all',
      false,
      { status: undefined as unknown as LocationState },
    ],
    ['not there', false, null],
  ] as const)('%s → listed: %s', (_label, listed, shop) => {
    expect(PartyAdmissionSystem.shopListed(shop)).toBe(listed);
  });

  it('reads the shop the commit reads — the stored location entity', () => {
    expect(PartyAdmissionSystem.shopListed(locationFixture())).toBe(true);
    expect(
      PartyAdmissionSystem.shopListed(
        locationFixture({ status: LocationState.Hidden }),
      ),
    ).toBe(false);
  });
});

describe('PartyAdmissionSystem.admit — the commit’s order', () => {
  const options = {
    locationId: LocationId.of(CENTER),
    allowConflictingServices: false,
  };
  const admitted = (
    seats: readonly {
      personKey: string;
      serviceId: string;
      variantId?: string | null;
      carried?: boolean;
    }[],
  ) =>
    PartyAdmissionSystem.admit(
      seats.map((seat) => ({
        personKey: seat.personKey,
        serviceId: seat.serviceId,
        variantId: seat.variantId ?? null,
        carried: seat.carried ?? false,
      })),
      CATALOGUE,
      BookingPolicy.DEFAULT,
      options,
    );

  it('refuses nobody to seat, then judges seat by seat', () => {
    expect(admitted([])).toEqual({
      ok: false,
      error: {
        code: 'booking.commit.invalid_input',
        field: 'seats',
        detail: null,
        reason: null,
      },
    });
    expect(
      admitted([
        { personKey: 'self', serviceId: 'svc-beard' },
        { personKey: 'self', serviceId: 'svc-shave' },
      ]),
    ).toEqual({
      ok: false,
      error: {
        code: 'booking.commit.conflicting_services',
        first: 'svc-shave',
        second: 'svc-beard',
      },
    });
  });

  it('lets a CARRIED seat survive its service retiring and keep no variant', () => {
    const result = admitted([
      { personKey: 'self', serviceId: 'svc-retired', carried: true },
      { personKey: 'self', serviceId: 'svc-color', carried: true },
    ]);
    expect(result.ok && result.value).toEqual([
      { service: null, variantId: null },
      { service: CATALOGUE[4], variantId: null },
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const catalogue = deepFreeze([...CATALOGUE]);
    const seats = deepFreeze([
      {
        personKey: 'self',
        serviceId: 'svc-cut',
        variantId: null,
        carried: false,
      },
      {
        personKey: 'g',
        serviceId: 'svc-color',
        variantId: 'long',
        carried: false,
      },
    ]);
    const run = () =>
      PartyAdmissionSystem.admit(
        seats,
        catalogue,
        BookingPolicy.DEFAULT,
        options,
      );
    expect(run()).toEqual(run());
    expect(seats.map((seat) => seat.serviceId)).toEqual([
      'svc-cut',
      'svc-color',
    ]);
    expect(ZonedTimeSystem.dayKeyOf(NOW_MS, DAYS)).toBe('2030-01-13');
  });
});
