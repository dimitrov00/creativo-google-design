import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { matchWaitlist } from '../../use-cases/match-waitlist';
import { matchWaitlistOnBusyChange } from './match-waitlist';
import {
  MAX_SERVICES_PER_PERSON,
  cartWithinReadBounds,
  loadCartServices,
  loadNamedShop,
  requestWaitlist,
} from './request-waitlist';

/*
 * THE WAITLIST REFUSES AT THE DOOR WHAT THE COMMIT REFUSES AT EVERY TIME
 * (round 6), on the production path: the callable, the catalogue read it
 * makes for the cart (`loadCartServices`, the commit's own parser), and the
 * decision (`decideWaitlist` → `cartAdmissible`), over an in-memory Admin
 * SDK. The clock is frozen so the requested day stays inside the horizon;
 * the request's life after the door moves it on (`clock.iso`).
 */

const NOW_ISO = '2030-01-13T08:00:00.000+02:00';
const fake = vi.hoisted(() => ({ db: null as unknown }));
const clock = vi.hoisted(() => ({ iso: null as string | null }));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));
vi.mock('./load-booking-policy', () => ({
  loadBookingPolicy: async () => BookingPolicy.default(),
}));
vi.mock('../../adapters/system-clock', () => ({
  SystemClock: class {
    now(zone: string) {
      return ZonedDateTime.fromISO(clock.iso ?? NOW_ISO, zone);
    }
  },
}));
// The real matcher, watched: whether the trigger asked it at all, and what
// it answered, is how a silence is told apart from a skipped request.
vi.mock('../../use-cases/match-waitlist', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../use-cases/match-waitlist')>();
  return { ...actual, matchWaitlist: vi.fn(actual.matchWaitlist) };
});

function serviceDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: { bg: 'Подстригване', en: 'Cut' },
    description: { bg: '—', en: '—' },
    categoryId: 'cat-hair',
    priceMinorUnits: 2500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    setupMinutes: 0,
    cleanupMinutes: 0,
    locationIds: [],
    conflictsWith: [],
    variants: [],
    offerings: [],
    composition: { kind: 'single' },
    upsellOnly: false,
    popular: false,
    status: 'active',
    sortOrder: 1,
    ...overrides,
  };
}

function shopDoc(status: string) {
  return {
    timezone: 'Europe/Sofia',
    status,
    hours: Array.from({ length: 7 }, () => ({
      kind: 'open',
      opens: '08:00',
      closes: '20:00',
    })),
  };
}

function seeded() {
  return createProjectionFirestore({
    'locations/loc-center': shopDoc('active'),
    // Taken off the public surface: `/book` does not list it and the
    // matcher never searches it.
    'locations/loc-hidden': shopDoc('hidden'),
    'services/svc-cut': serviceDoc(),
    'services/svc-retired': serviceDoc({ status: 'archived' }),
    'services/svc-color': serviceDoc({
      variants: [
        { id: 'short', name: { bg: 'Къса', en: 'Short' } },
        { id: 'long', name: { bg: 'Дълга', en: 'Long' } },
      ],
    }),
  });
}

function cartOf(...serviceIds: readonly string[]) {
  return {
    seats: serviceIds.map((serviceId, index) => ({
      seatKey: index === 0 ? 'self' : `guest-${index}`,
      lines: [
        { id: `line-${index}`, serviceId, variantId: null, barberId: null },
      ],
    })),
    nextSequence: serviceIds.length,
  };
}

function request(
  cart: unknown,
  locationId: string | null = 'loc-center',
): Promise<unknown> {
  return requestWaitlist.run({
    data: {
      locationId,
      when: {
        days: [
          { dayKey: '2030-01-15', windows: [{ from: '10:00', to: '12:00' }] },
        ],
      },
      cart,
    },
    auth: { uid: 'user-waiting', token: { roles: ['client'] } },
  } as unknown as CallableRequest);
}

async function refusalOf(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('requestWaitlist — the party, admitted as the commit admits it', () => {
  let db: ReturnType<typeof seeded>;

  beforeEach(() => {
    db = seeded();
    fake.db = db.db;
  });

  it('records a request the commit could book', async () => {
    const accepted = (await request(cartOf('svc-cut'))) as {
      requestId: string;
    };

    expect(accepted.requestId).toMatch(/^wl_/);
    expect(db.docs.has(`waitlistRequests/${accepted.requestId}`)).toBe(true);
  });

  it.each([
    [
      'a retired service',
      cartOf('svc-retired'),
      'booking.commit.unknown_service',
    ],
    [
      'an unknown service',
      cartOf('svc-nope'),
      'booking.commit.unknown_service',
    ],
    [
      'a service with variants and none chosen',
      cartOf('svc-color'),
      'booking.commit.invalid_input',
    ],
    [
      'a service id that names no document',
      cartOf('services/../x'),
      'booking.commit.unknown_service',
    ],
  ])('refuses %s, and records nothing', async (_what, cart, reason) => {
    const refusal = await refusalOf(request(cart));

    expect(refusal).toBeInstanceOf(HttpsError);
    expect((refusal as HttpsError).code).toBe('invalid-argument');
    expect((refusal as HttpsError).details).toEqual({
      code: 'booking.waitlist.invalid_request',
      params: { field: reason },
    });
    expect(
      [...db.docs.keys()].some((path) => path.startsWith('waitlist')),
    ).toBe(false);
  });
});

describe('requestWaitlist — a crafted cart costs the shop no reads', () => {
  const cap = BookingPolicy.default().maxPartySize;
  let db: ReturnType<typeof seeded>;

  beforeEach(() => {
    db = seeded();
    fake.db = db.db;
  });

  it('refuses a party past the cap as the commit does, without reading the catalogue', async () => {
    const getAll = vi.spyOn(db.db as unknown as Firestore, 'getAll');
    const seats = Array.from({ length: cap + 1 }, () => 'svc-cut');

    const refusal = await refusalOf(request(cartOf(...seats)));

    expect((refusal as HttpsError).details).toEqual({
      code: 'booking.waitlist.invalid_request',
      params: { field: 'booking.commit.party_too_large' },
    });
    expect(getAll).not.toHaveBeenCalled();
  });

  it('refuses a cart naming more services than the party could ask for, without reading', async () => {
    const getAll = vi.spyOn(db.db as unknown as Firestore, 'getAll');
    const lines = Array.from(
      { length: MAX_SERVICES_PER_PERSON * cap + 1 },
      (_, index) => ({
        id: `line-${index}`,
        serviceId: `svc-${index}`,
        variantId: null,
        barberId: null,
      }),
    );

    const refusal = await refusalOf(
      request({ seats: [{ seatKey: 'self', lines }], nextSequence: 1 }),
    );

    expect(refusal).toBeInstanceOf(HttpsError);
    expect(getAll).not.toHaveBeenCalled();
    expect(
      [...db.docs.keys()].some((path) => path.startsWith('waitlist')),
    ).toBe(false);
  });

  it('still reads, once, for a cart inside the bounds', async () => {
    const getAll = vi.spyOn(db.db as unknown as Firestore, 'getAll');

    await request(cartOf('svc-cut'));

    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('draws the bound at the cap and at the per-person service count', () => {
    const withLines = (count: number) => ({
      seats: [
        {
          seatKey: 'self',
          lines: Array.from({ length: count }, (_, index) => ({
            id: `line-${index}`,
            serviceId: `svc-${index}`,
            variantId: null,
            barberId: null,
          })),
        },
      ],
      nextSequence: 1,
    });
    expect(
      cartWithinReadBounds(withLines(MAX_SERVICES_PER_PERSON * cap), cap),
    ).toBe(true);
    expect(
      cartWithinReadBounds(withLines(MAX_SERVICES_PER_PERSON * cap + 1), cap),
    ).toBe(false);
  });
});

describe('loadCartServices — the catalogue rows a cart names, read as the commit reads them', () => {
  it('reads each named service once, and only the active ones', async () => {
    const db = seeded();
    const services = await loadCartServices(
      db.db as unknown as Firestore,
      cartOf('svc-cut', 'svc-cut', 'svc-retired', 'svc-nope'),
    );

    expect(services.map((service) => service.id.value)).toEqual(['svc-cut']);
  });
});

/*
 * A WAITLIST REQUEST NAMES A SHOP THE COMMIT WOULD ACCEPT (team decision,
 * 2026-09-26), read through the commit's own reading of a location document
 * (`toShop`): a shop the commit would not find is refused, one the public
 * surface no longer lists is refused, and "any shop" stays valid. A refusal
 * writes nothing.
 */
describe('requestWaitlist — the shop it names, as the commit reads it', () => {
  let db: ReturnType<typeof seeded>;

  beforeEach(() => {
    db = seeded();
    fake.db = db.db;
  });

  const refusedFor = { code: 'booking.waitlist.invalid_request' };
  const nothingWritten = () =>
    [...db.docs.keys()].some((path) => path.startsWith('waitlist'));

  it.each([
    ['a shop that does not exist', 'loc-nowhere'],
    ['a shop taken off the public surface', 'loc-hidden'],
    ['an id that names no document', 'locations/../x'],
  ])('refuses %s, and records nothing', async (_what, locationId) => {
    const refusal = await refusalOf(request(cartOf('svc-cut'), locationId));

    expect(refusal).toBeInstanceOf(HttpsError);
    expect((refusal as HttpsError).code).toBe('invalid-argument');
    expect((refusal as HttpsError).details).toEqual({
      ...refusedFor,
      params: { field: 'locationId' },
    });
    expect(nothingWritten()).toBe(false);
  });

  it('records a request for any shop — none named, none read', async () => {
    const accepted = (await request(cartOf('svc-cut'), null)) as {
      requestId: string;
    };

    expect(db.docs.get(`waitlistRequests/${accepted.requestId}`)).toMatchObject(
      { locationId: null },
    );
  });

  it('records a request for a listed shop', async () => {
    const accepted = (await request(cartOf('svc-cut'), 'loc-center')) as {
      requestId: string;
    };

    expect(db.docs.get(`waitlistRequests/${accepted.requestId}`)).toMatchObject(
      { locationId: 'loc-center' },
    );
  });

  it('reads nothing for a visitor who is not signed in', async () => {
    const collection = vi.spyOn(db.db, 'collection');
    const getAll = vi.spyOn(db.db as unknown as Firestore, 'getAll');

    const refusal = await refusalOf(
      requestWaitlist.run({
        data: {
          locationId: 'loc-nowhere',
          when: {
            days: [
              {
                dayKey: '2030-01-15',
                windows: [{ from: '10:00', to: '12:00' }],
              },
            ],
          },
          cart: cartOf('svc-cut'),
        },
      } as unknown as CallableRequest),
    );

    expect((refusal as HttpsError).details).toMatchObject({
      code: 'booking.waitlist.unauthenticated',
    });
    expect(collection).not.toHaveBeenCalled();
    expect(getAll).not.toHaveBeenCalled();
  });
});

describe('loadNamedShop — the shop a request names, read as the commit reads it', () => {
  it('reads a listed shop as active, with its own zone and hours', async () => {
    const db = seeded();
    const shop = await loadNamedShop(
      db.db as unknown as Firestore,
      'loc-center',
    );

    expect(shop).toMatchObject({ active: true, zone: 'Europe/Sofia' });
    expect(shop?.hours).toHaveLength(7);
  });

  it('reads a hidden shop as there, but not active', async () => {
    const db = seeded();

    expect(
      await loadNamedShop(db.db as unknown as Firestore, 'loc-hidden'),
    ).toMatchObject({ active: false });
  });

  it('reads a shop that is not there as nothing', async () => {
    const db = seeded();

    expect(
      await loadNamedShop(db.db as unknown as Firestore, 'loc-nowhere'),
    ).toBeNull();
  });

  it('does not read an id that names no document', async () => {
    const db = seeded();
    const collection = vi.spyOn(db.db, 'collection');

    expect(
      await loadNamedShop(db.db as unknown as Firestore, 'locations/../x'),
    ).toBeNull();
    expect(collection).not.toHaveBeenCalled();
  });
});

/*
 * A REQUEST WHOSE SHOP WAS HIDDEN SINCE IS SKIPPED, NOT CLOSED, AND STILL
 * LAPSES BY ITS DAYS (team decision, 2026-09-26), through the production
 * trigger (`matchWaitlistOnBusyChange`). The request is made at the door
 * while Center is listed, then Center — this tenant's only shop — is
 * hidden, which leaves every day with nothing to search. The trigger
 * reads each request's lapse only after it loads the day, so the day
 * loader must answer an EMPTY day, not `null`: before it did, such a
 * request stayed `open` after its last day had passed.
 */
describe('the request after the door — its only shop hidden since', () => {
  const DAY_KEY = '2030-01-15';
  let db: ReturnType<typeof seeded>;

  beforeEach(() => {
    db = seeded();
    fake.db = db.db;
    vi.mocked(matchWaitlist).mockClear();
    // Ivan works Center all Tuesday: with the shop listed, the day HAS
    // something to search.
    db.docs.set('barbers/ivan', { status: 'active' });
    db.docs.set('barberSchedules/ivan', {
      barberId: 'ivan',
      turnaroundMinutes: 0,
      versions: [
        {
          seq: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern: {
            tuesday: [
              { start: '09:00', end: '18:00', locationId: 'loc-center' },
            ],
          },
        },
      ],
    });
  });

  afterEach(() => {
    clock.iso = null;
  });

  /** A request made while Center is listed; Center hidden after it. */
  async function madeThenHidden(): Promise<string> {
    const { requestId } = (await request(cartOf('svc-cut'), 'loc-center')) as {
      requestId: string;
    };
    await db.db
      .collection('locations')
      .doc('loc-center')
      .update({ status: 'hidden' });
    return requestId;
  }

  /** A write to Ivan's busy projection for the watched day. */
  async function busyChanged(): Promise<void> {
    await matchWaitlistOnBusyChange.run({
      data: {
        after: {
          data: () => ({ dayKey: DAY_KEY, zone: 'Europe/Sofia' }),
        },
      },
      params: { docId: `ivan__${DAY_KEY}` },
    } as unknown as Parameters<typeof matchWaitlistOnBusyChange.run>[0]);
  }

  const statusOf = (requestId: string): unknown =>
    db.docs.get(`waitlistRequests/${requestId}`)?.['status'];
  const notified = (): boolean =>
    db.writes.some((path) => path.startsWith('users/'));

  it('keeps watching while its day is ahead: asked, nothing to search, nothing sent', async () => {
    const requestId = await madeThenHidden();
    clock.iso = '2030-01-14T09:00:00.000+02:00';

    await busyChanged();

    expect(statusOf(requestId)).toBe('open');
    expect(notified()).toBe(false);
    // The trigger did ask about it — on a day with nobody to search, since
    // the only shop is hidden — and was told nothing fits.
    const asked = vi.mocked(matchWaitlist).mock;
    expect(asked.calls).toHaveLength(1);
    expect(asked.calls[0]?.[2].barbers).toEqual([]);
    expect(asked.results[0]?.value).toBeNull();
  });

  it('expires once its last day has passed, though its shop is still hidden', async () => {
    const requestId = await madeThenHidden();
    clock.iso = '2030-01-16T09:00:00.000+02:00';

    await busyChanged();

    expect(statusOf(requestId)).toBe('expired');
    expect(notified()).toBe(false);
    expect(matchWaitlist).not.toHaveBeenCalled();
  });

  it('expires the same way on a day nobody is rostered, shop listed', async () => {
    const { requestId } = (await request(cartOf('svc-cut'), 'loc-center')) as {
      requestId: string;
    };
    db.docs.delete('barberSchedules/ivan');
    clock.iso = '2030-01-16T09:00:00.000+02:00';

    await busyChanged();

    expect(statusOf(requestId)).toBe('expired');
  });
});
