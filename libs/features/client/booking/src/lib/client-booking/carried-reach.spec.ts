import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BookingDraftRider, Result } from '@creativo/application/booking';
import { Barber, Location, Service } from '@creativo/application/catalog';
import { carriedSeatsInReach } from './carried-reach';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function beard(
  variants: readonly string[] = [],
  locationIds: readonly string[] = [],
): Service {
  return offered('svc-beard', locationIds, variants);
}

/** A live service `id`, offered at `locationIds` (every shop when empty). */
function offered(
  id: string,
  locationIds: readonly string[] = [],
  variants: readonly string[] = [],
): Service {
  return unwrap(
    Service.create({
      id,
      name: { bg: id, en: id },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2000,
      currencyCode: 'EUR',
      durationMinutes: 30,
      locationIds: [...locationIds],
      conflictsWith: [],
      variants: variants.map((id) => ({ id, name: { bg: id, en: id } })),
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

function barber(id: string): Barber {
  return unwrap(
    Barber.create({
      id,
      name: { bg: id, en: id },
      handle: id,
      title: { bg: 'Бръснар', en: 'Barber' },
      bio: { bg: '—', en: '—' },
      locationIds: [],
      status: 'active',
      sortOrder: 1,
    }),
  );
}

/** An ACTIVE shop, by id. */
function shop(id: string): Location {
  const open = { kind: 'open' as const, opens: '09:00', closes: '20:00' };
  return unwrap(
    Location.create({
      id,
      name: { en: id, bg: id },
      address: { en: '—', bg: '—' },
      phone: { e164: '+359881234567', display: '+359 88 123 4567' },
      geo: { lat: 42.6977, lng: 23.3219 },
      mapUrl: `https://maps.example.com/${id}`,
      hours: [open, open, open, open, open, open, { kind: 'closed' }],
      timezone: 'Europe/Sofia',
      status: 'active',
      sortOrder: 0,
    }),
  );
}

/** The son the shop seated: a beard with Petar. */
function son(overrides: Partial<BookingDraftRider> = {}): BookingDraftRider {
  return {
    serviceId: 'svc-beard',
    variantId: null,
    barberId: 'petar',
    offsetMinutes: 0,
    durationMinutes: 30,
    setupMinutes: 0,
    cleanupMinutes: 0,
    ...overrides,
  };
}

describe('carriedSeatsInReach — can the shop still serve who a move carries?', () => {
  it('is true when the barber is active and the service (and its variant) still offered', () => {
    expect(
      carriedSeatsInReach([son()], [beard()], [barber('petar')], null),
    ).toBe(true);
    expect(
      carriedSeatsInReach(
        [son({ variantId: 'v-long' })],
        [beard(['v-short', 'v-long'])],
        [barber('petar')],
        null,
      ),
    ).toBe(true);
  });

  it('is true for a move that carries nobody', () => {
    expect(carriedSeatsInReach([], [], [], null)).toBe(true);
  });

  it('is false when the barber is off the active list', () => {
    expect(
      carriedSeatsInReach([son()], [beard()], [barber('ivan')], null),
    ).toBe(false);
  });

  it('is false when the service is retired', () => {
    expect(carriedSeatsInReach([son()], [], [barber('petar')], null)).toBe(
      false,
    );
  });

  it('is false when only the VARIANT the seat was sold as is retired — the server refuses that too', () => {
    expect(
      carriedSeatsInReach(
        [son({ variantId: 'v-long' })],
        [beard(['v-short'])],
        [barber('petar')],
        null,
      ),
    ).toBe(false);
  });

  it('keeps a seat sold before its service had variants — the server keeps its stored terms', () => {
    expect(
      carriedSeatsInReach(
        [son()],
        [beard(['v-short'])],
        [barber('petar')],
        null,
      ),
    ).toBe(true);
  });

  it('is false when ANY one of several carried seats is out of reach', () => {
    expect(
      carriedSeatsInReach(
        [son(), son({ barberId: 'niko' })],
        [beard()],
        [barber('petar')],
        null,
      ),
    ).toBe(false);
  });

  // The grid runs only the shops that offer every service on the visit
  // (`shopsServingParty`). A beard whose `locationIds` name only a shop that
  // has since closed is served nowhere: every shop's grid is empty, and the
  // server refuses the son wherever the move goes. That is the call, not a
  // calendar of empty days.
  it('is false when no ACTIVE shop offers the carried seat’s service any more', () => {
    expect(
      carriedSeatsInReach(
        [son()],
        [beard([], ['loc-closed'])],
        [barber('petar')],
        [shop('loc-center'), shop('loc-mladost')],
      ),
    ).toBe(false);
  });

  it('is true while ONE active shop still offers it — which shop is the schedule step’s to say', () => {
    expect(
      carriedSeatsInReach(
        [son()],
        [beard([], ['loc-center'])],
        [barber('petar')],
        [shop('loc-center'), shop('loc-mladost')],
      ),
    ).toBe(true);
    expect(
      carriedSeatsInReach(
        [son()],
        [beard()],
        [barber('petar')],
        [shop('loc-mladost')],
      ),
    ).toBe(true);
  });

  it('does not ask about shops before the shop read has answered — a list that has not arrived is not “no shop”', () => {
    expect(
      carriedSeatsInReach(
        [son()],
        [beard([], ['loc-closed'])],
        [barber('petar')],
        null,
      ),
    ).toBe(true);
  });

  it('is false when the shop read has answered with no active shop — there is nowhere to seat him', () => {
    expect(carriedSeatsInReach([son()], [beard()], [barber('petar')], [])).toBe(
      false,
    );
  });

  // The carried seats move together, to ONE shop. A fade offered only at the
  // Center and braids offered only in Mladost are each served somewhere,
  // never together: the grid runs no shop for the party, and the schedule
  // step's «Промени услугите» cannot change a companion's service.
  it('is false when every carried seat is served somewhere but no ONE active shop serves them all', () => {
    const riders = [
      son({ serviceId: 'svc-fade', barberId: 'petar' }),
      son({ serviceId: 'svc-braids', barberId: 'niko' }),
    ];
    const services = [
      offered('svc-fade', ['loc-center']),
      offered('svc-braids', ['loc-mladost']),
    ];
    const barbers = [barber('petar'), barber('niko')];
    const shops = [shop('loc-center'), shop('loc-mladost')];

    expect(carriedSeatsInReach(riders, services, barbers, shops)).toBe(false);
    // Each alone is in reach: it is the set that is not.
    for (const rider of riders) {
      expect(carriedSeatsInReach([rider], services, barbers, shops)).toBe(true);
    }
  });

  it('is true when one active shop serves every carried seat, whatever else each is offered at', () => {
    expect(
      carriedSeatsInReach(
        [
          son({ serviceId: 'svc-fade', barberId: 'petar' }),
          son({ serviceId: 'svc-braids', barberId: 'niko' }),
        ],
        [
          offered('svc-fade', ['loc-center', 'loc-mladost']),
          offered('svc-braids', ['loc-mladost']),
        ],
        [barber('petar'), barber('niko')],
        [shop('loc-center'), shop('loc-mladost')],
      ),
    ).toBe(true);
  });

  // The oracle, stated independently of `shopsServingParty`: with every
  // barber and service live, the carried seats are in reach exactly when
  // some active shop lies in every carried service's reach (a service with
  // no `locationIds` is offered at every shop).
  it('is true exactly when some active shop offers every carried service', () => {
    const SHOP_IDS = ['loc-a', 'loc-b', 'loc-c'] as const;
    const SERVICE_IDS = ['svc-1', 'svc-2', 'svc-3', 'svc-4'] as const;
    const reachOf = fc.subarray([...SHOP_IDS, 'loc-closed']);
    fc.assert(
      fc.property(
        fc.tuple(reachOf, reachOf, reachOf, reachOf),
        fc.subarray([...SHOP_IDS]),
        fc.array(fc.constantFrom(...SERVICE_IDS), {
          minLength: 1,
          maxLength: 4,
        }),
        (reaches, activeShops, carriedServices) => {
          const reachById = new Map(
            SERVICE_IDS.map((id, index) => [id, reaches.at(index) ?? []]),
          );
          const services = SERVICE_IDS.map((id) =>
            offered(id, reachById.get(id)),
          );
          const riders = carriedServices.map((serviceId) =>
            son({ serviceId, barberId: 'petar' }),
          );
          const servesAt = (
            serviceId: (typeof SERVICE_IDS)[number],
            shopId: string,
          ): boolean => {
            const reach = reachById.get(serviceId) ?? [];
            return reach.length === 0 || reach.includes(shopId);
          };
          const expected = activeShops.some((shopId) =>
            carriedServices.every((serviceId) => servesAt(serviceId, shopId)),
          );

          expect(
            carriedSeatsInReach(
              riders,
              services,
              [barber('petar')],
              activeShops.map(shop),
            ),
          ).toBe(expected);
        },
      ),
    );
  });
});
