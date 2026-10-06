import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Result } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  Service,
  ServiceId,
} from '@creativo/domain/catalog';
import { BarberPref, BookingCart, SeatKey } from '@creativo/domain/scheduling';
import {
  type MoveRider,
  type PartyServices,
  partyServicesOf,
  shopsServingParty,
} from './party-shops';
import partyShopsSource from './party-shops.ts?raw';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const SHOPS = ['loc-center', 'loc-mladost', 'loc-lozenets'] as const;
const shop = (id: string) => unwrap(LocationId.create(id));
const serviceId = (id: string) => unwrap(ServiceId.create(id));

/** A service offered at `locationIds` (empty ⇒ every shop). */
function serviceAt(id: string, locationIds: readonly string[]): Service {
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
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      offerings: [],
      status: 'active',
      sortOrder: 1,
    }),
  );
}

/** A cut everywhere, a beard at Center, a perm at Center and Mladost. */
const CATALOG = [
  serviceAt('svc-cut', []),
  serviceAt('svc-beard', ['loc-center']),
  serviceAt('svc-perm', ['loc-center', 'loc-mladost']),
];

function party(
  lines: readonly string[],
  riders: readonly string[] = [],
): PartyServices {
  return {
    lineServiceIds: lines.map(serviceId),
    riderServiceIds: riders.map(serviceId),
  };
}

function serving(
  asked: PartyServices,
  services: readonly Service[] = CATALOG,
): readonly string[] {
  return shopsServingParty(asked, services, SHOPS.map(shop)).map(
    (id) => id.value,
  );
}

describe('shopsServingParty — the shops that can serve the whole visit', () => {
  it('keeps every shop, in the order given, for services every shop offers', () => {
    expect(serving(party(['svc-cut'], ['svc-cut']))).toEqual([...SHOPS]);
    expect(serving(party([]))).toEqual([...SHOPS]);
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
    expect(serving(party(['svc-retired']))).toEqual([...SHOPS]);
  });

  it('serves a carried seat the catalog does not know NOWHERE — the server refuses it', () => {
    expect(serving(party(['svc-cut'], ['svc-retired']))).toEqual([]);
  });

  // Every seat is one more service a shop has to offer: a bigger visit is
  // never served at a shop the smaller one was not.
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

describe('partyServicesOf — what a visit asks a shop for', () => {
  it('names every cart line’s service and every carried seat’s', () => {
    const cart = unwrap(
      unwrap(
        BookingCart.empty().addLine(SeatKey.self(), {
          serviceId: serviceId('svc-cut'),
          variantId: null,
          barberPref: BarberPref.any(),
        }),
      ).addLine(SeatKey.self(), {
        serviceId: serviceId('svc-beard'),
        variantId: null,
        barberPref: BarberPref.any(),
      }),
    );
    const son: MoveRider = {
      serviceId: serviceId('svc-perm'),
      barberId: unwrap(BarberId.create('niko')),
      offsetMinutes: 0,
      terms: { durationMinutes: 30, padBeforeMinutes: 0, padAfterMinutes: 0 },
    };

    const asked = partyServicesOf(cart, [son]);

    expect(asked.lineServiceIds.map((id) => id.value)).toEqual([
      'svc-cut',
      'svc-beard',
    ]);
    expect(asked.riderServiceIds.map((id) => id.value)).toEqual(['svc-perm']);
    expect(partyServicesOf(cart).riderServiceIds).toEqual([]);
  });
});

describe('party-shops — the lower module', () => {
  // The shop rule is consumed by the day query, so the day query imports
  // it. The rule importing anything back (even a type, which erases) is the
  // cycle this module was cut free of: `MoveRider` lives here for that.
  it('imports nothing from the day query that consumes it', () => {
    expect(partyShopsSource).not.toMatch(/from\s+'\.\/observe-availability/);
  });
});
