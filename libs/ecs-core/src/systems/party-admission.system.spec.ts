import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingErrorCode,
  CartLineId,
  LocationId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
} from '@core/primitives';
import {
  BookingPolicy,
  type BookingCart,
  LocationStatus,
  PlacementPolicy,
} from '@core/components';
import type { Service } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  localDate,
  minute,
  textFixture,
  unwrapOk,
  utcMs,
  locationFixture,
  serviceFixture,
  termsFixture,
} from '@core/testing';
import {
  BookingDecisionSystem,
  type RequestedSeatInput,
} from './booking-decision.system';
import { RequestedSubjectRole } from './guest-label.system';
import { PartyAdmissionSystem } from './party-admission.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of apps/functions/src/use-cases/party-admission.spec.ts (7),
 * COPIED: ONE RULE FOR "THE COMMIT REFUSES THIS WHATEVER THE TIME". The
 * waitlist admits a cart through `admitCart`; the commit decides the same
 * party through `BookingDecisionSystem.decide`; both ask `admit`, so over
 * random carts, caps, shops and catalogues they refuse together, with the
 * same code. `toShop` (the functions' document reader) stays with its
 * adapter; here the shop is the stored `locationStatus`.
 */

const CENTER = 'loc-center';
const MLADOST = 'loc-mladost';
/** 2030-01-13 08:00 in Sofia (winter time, UTC+2) — the shop's "now". */
const NOW = ZonedTimeSystem.shopNow(
  utcMs('2030-01-13T08:00:00+02:00'),
  FIXTURE_TIME_ZONE,
);
/** Two days on, 08:00 — every requested seat's start. */
const START_DATE = localDate('2030-01-15');
const START_MINUTES = minute(8 * 60);

/** The refusals that do not depend on the time — `admit`'s. */
const ADMISSION = new Set<string>([
  BookingErrorCode.PartyTooLarge,
  BookingErrorCode.UnknownService,
  BookingErrorCode.ServiceNotAtLocation,
  BookingErrorCode.InvalidInput,
  BookingErrorCode.ConflictingServices,
]);

function service(
  id: string,
  overrides: {
    readonly locationIds?: readonly string[];
    readonly conflictsWith?: readonly string[];
    readonly variants?: readonly string[];
  } = {},
): Service {
  return serviceFixture({
    id: ServiceId.of(id),
    ...termsFixture(2500, 30),
    locationIds: (overrides.locationIds ?? []).map(LocationId.of),
    conflictsWith: (overrides.conflictsWith ?? []).map(ServiceId.of),
    variants: (overrides.variants ?? []).map((variant) => ({
      variantId: ServiceVariantId.of(variant),
      name: textFixture(variant),
    })),
    offerings: [],
  });
}

const CATALOGUE: readonly Service[] = [
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
            cartSeats: seats.map((lines, index) => {
              const seatKey = SeatKeyText.of(
                index === 0 ? 'self' : `guest-${index}`,
              );
              return {
                seatKey,
                lines: lines.map((line) => ({
                  lineId: CartLineId.of(`line-${sequence++}`),
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
            cartNextSequence: sequence,
          };

          const waitlist = PartyAdmissionSystem.admitCart(
            cart,
            CATALOGUE,
            policy,
            LocationId.of(shop),
          );

          const requested = cart.cartSeats.flatMap((seat) =>
            seat.lines.map((line): RequestedSeatInput => ({
              lineId: line.lineId,
              serviceId: line.serviceId,
              variantId: line.variantId,
              barberId: 'ivan',
              barberPreference: null,
              startMinutes: START_MINUTES,
              subject:
                seat.seatKey === 'self'
                  ? { requestedSubjectRole: RequestedSubjectRole.Self }
                  : {
                      requestedSubjectRole: RequestedSubjectRole.Guest,
                      label: seat.seatKey,
                      guestKey: seat.seatKey,
                    },
            })),
          );
          const commit = BookingDecisionSystem.decide(
            {
              locationId: shop,
              localDate: START_DATE,
              seats: requested,
              attemptId: null,
              bookedFromAppointmentId: null,
              contact: null,
              placement: null,
            },
            {
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
              now: NOW,
              startUtcMs: unwrapOk(
                ZonedTimeSystem.toUtc(
                  START_DATE,
                  START_MINUTES,
                  FIXTURE_TIME_ZONE,
                ),
              ),
              nextId: () => 'seat',
              ownerUserId: UserId.of('user-1'),
              termsOverrides: [],
              standing: [],
              stood: [],
              parsePhone: () => null,
            },
          );
          // Anything past admission (no roster here) is the commit's
          // time-dependent answer, and none of the waitlist's business.
          const commitAdmission =
            !commit.ok && ADMISSION.has(commit.error.errorCode)
              ? commit.error.errorCode
              : null;

          expect(waitlist.ok ? null : waitlist.error.errorCode).toBe(
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
 * that is there AND `ACTIVE` is listed. A missing document, `HIDDEN`, a
 * status the domain does not know (`ARCHIVED`) and no status at all are
 * each refused: fail-closed.
 */
describe('shopListed — the shop a waitlist may watch', () => {
  it.each([
    ['there and active', true, { locationStatus: LocationStatus.Active }],
    ['hidden', false, { locationStatus: LocationStatus.Hidden }],
    [
      'a status nobody modelled',
      false,
      { locationStatus: 'ARCHIVED' as LocationStatus },
    ],
    [
      'no status at all',
      false,
      { locationStatus: undefined as unknown as LocationStatus },
    ],
    ['not there', false, null],
  ] as const)('%s → listed: %s', (_label, listed, shop) => {
    expect(PartyAdmissionSystem.shopListed(shop)).toBe(listed);
  });

  it('reads the shop the commit reads — the stored location entity', () => {
    expect(PartyAdmissionSystem.shopListed(locationFixture())).toBe(true);
    expect(
      PartyAdmissionSystem.shopListed(
        locationFixture({ locationStatus: LocationStatus.Hidden }),
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
        errorCode: 'BOOKING_INVALID_INPUT',
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
        errorCode: 'BOOKING_CONFLICTING_SERVICES',
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
    expect(NOW.localDate).toBe('2030-01-13');
    expect(NOW.currentMinute).toBe(8 * 60);
  });
});
