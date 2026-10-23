import { describe, expect, it } from 'vitest';
import {
  BookingPolicy,
  type BookingCart,
  type DocBody,
  DayWindows,
  LocationStatus,
  MinuteRange,
  ServiceStatus,
  WaitlistLifecycle,
  WriteOp,
  type WaitlistCall,
} from '@core/components';
import {
  CartLineId,
  LocationId,
  Result,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  WaitlistRequestId,
} from '@core/primitives';
import { BookingErrorCode, RepositoryError, WaitlistError } from '@core/errors';
import {
  Collections,
  type Service,
  type ShopLocation,
  type WaitlistRequest,
} from '@core/entities';
import type { CatalogSnapshot, CommitPlan } from '@core/ports';
import { WaitlistSystem, ZonedTimeSystem } from '@core/systems';
import {
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  fixtureHash,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryStore,
  memoryTxPorts,
  minute,
  recordingTelemetry,
  serviceFixture,
} from '@core/testing';
import {
  requestWaitlist,
  waitlistRequestIdOf,
} from './request-waitlist.pipeline';

/*
 * The waitlist's door (`request-waitlist.ts`, `decide-waitlist.ts`): it
 * refuses now what the commit refuses at every time, reads the catalogue
 * only for a caller who can be notified and a cart inside the read bound,
 * and records ONE deterministic `Create` — `wl_` + the digest of what the
 * request means. The door's own rules are `WaitlistSystem`'s and
 * `PartyAdmissionSystem`'s specs; this one asserts the reads, the refusals
 * as they leave, and the plan that reached the commit.
 */

const CUT = FIXTURE_IDS.service;
const RETIRED = ServiceId.of('svc-retired');
const COLOUR = ServiceId.of('svc-colour');
const NORTH_CUT = ServiceId.of('svc-north-cut');
const CENTRE = FIXTURE_IDS.location;
const HIDDEN = LocationId.of('loc-hidden');
const NORTH = LocationId.of('loc-north');
const DAY = localDate('2026-09-30');
const LONDON = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/London');
  if (!zone.ok) throw new Error('a broken fixture zone');
  return zone.value;
})();

const CATALOG: ReadonlyMap<string, Service> = new Map([
  [CUT, serviceFixture({ offerings: [] })],
  [
    NORTH_CUT,
    serviceFixture({
      id: NORTH_CUT,
      offerings: [],
      locationIds: [LocationId.of('loc-north')],
    }),
  ],
  [
    RETIRED,
    serviceFixture({ id: RETIRED, serviceStatus: ServiceStatus.Archived }),
  ],
  [
    COLOUR,
    serviceFixture({
      id: COLOUR,
      offerings: [],
      variants: [
        {
          variantId: ServiceVariantId.of('short'),
          name: { bg: 'Къса', en: 'Short' },
        },
      ],
    }),
  ],
]);
const SHOPS: ReadonlyMap<string, ShopLocation> = new Map([
  [CENTRE, locationFixture()],
  [
    HIDDEN,
    locationFixture({ id: HIDDEN, locationStatus: LocationStatus.Hidden }),
  ],
  [NORTH, locationFixture({ id: NORTH, timeZone: LONDON })],
]);

/**
 * The shop's clock (Law 7.2): the named shop's zone, else the default
 * location's — the centre, on `FIXTURE_TIME_ZONE` (F-4).
 */
const ZONE_PORTS = {
  loadLocation: async (id: LocationId) => Result.ok(SHOPS.get(id) ?? null),
  ...memoryDefaultLocationPorts(CENTRE),
};

/** One seat per service, the first the booker's own. */
function cartOf(...serviceIds: readonly string[]): BookingCart {
  return {
    cartSeats: serviceIds.map((serviceId, index) => {
      const seatKey = SeatKeyText.of(index === 0 ? 'self' : `guest-${index}`);
      return {
        seatKey,
        lines: [
          {
            lineId: CartLineId.of(`line-${index}`),
            seatKey,
            serviceId: ServiceId.of(serviceId),
            variantId: null,
            barberId: null,
            locationId: null,
          },
        ],
      };
    }),
    cartNextSequence: serviceIds.length,
  };
}

function askOf(
  cart: BookingCart,
  locationId: string | null = CENTRE,
): WaitlistCall.Input {
  return {
    locationId,
    days: [
      { localDate: DAY, windows: [{ startMinutes: 600, endMinutes: 720 }] },
    ],
    cart,
  };
}

function rig(
  options: {
    readonly stored?: readonly {
      readonly path: readonly string[];
      readonly body: DocBody;
    }[];
    readonly commit?: CommitPlan;
  } = {},
) {
  const store = memoryStore(options.stored ?? []);
  const tx = memoryTxPorts(store, { hash: fixtureHash });
  const reads: {
    readonly serviceIds: readonly ServiceId[];
    readonly locationId: LocationId | null;
  }[] = [];
  const run = requestWaitlist({
    ...tx,
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    ...recordingTelemetry(),
    ...ZONE_PORTS,
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    loadCatalog: async (serviceIds, locationId) => {
      reads.push({ serviceIds, locationId });
      const snapshot: CatalogSnapshot = {
        services: serviceIds.map((id) => CATALOG.get(id) ?? null),
        location: locationId === null ? null : (SHOPS.get(locationId) ?? null),
      };
      return Result.ok(snapshot);
    },
  });
  return { store, tx, reads, run };
}

const owner = FIXTURE_IDS.client;
const command = (ask: WaitlistCall.Input) => ({ ownerUserId: owner, ask });

/** The stored request a decided ask leaves, built by hand. */
function storedRequest(
  cart: BookingCart,
  locationId: LocationId | null,
): Omit<WaitlistRequest, 'id'> {
  return {
    ownerUserId: owner,
    locationId,
    cartSeats: cart.cartSeats,
    cartNextSequence: cart.cartNextSequence,
    flexibleDays: [
      DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(720))]),
    ],
    localDates: [DAY],
    ...WaitlistLifecycle.open(FIXTURE_NOW_UTC_MS),
    createdAtUtcMs: FIXTURE_NOW_UTC_MS,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, FIXTURE_TIME_ZONE),
  };
}

describe('requestWaitlist — the party, admitted as the commit admits it', () => {
  it('records a request the commit could book: one Create under its deterministic id, read first in the transaction', async () => {
    const cart = cartOf(CUT);
    const { tx, run } = rig();
    const answer = await run(command(askOf(cart)));
    const body = storedRequest(cart, CENTRE);
    const id = waitlistRequestIdOf(body, fixtureHash);
    expect(answer).toEqual({ ok: true, value: { requestId: id } });
    expect(id).toBe(
      `wl_${fixtureHash(WaitlistSystem.idBasis(body)).slice(0, 40)}`,
    );
    expect(tx.plans).toEqual([
      [WriteOp.create([Collections.WaitlistRequests, id], body)],
    ]);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.WaitlistRequests, id],
    ]);
  });

  it.each([
    ['a retired service', RETIRED, BookingErrorCode.UnknownService],
    ['an unknown service', 'svc-nope', BookingErrorCode.UnknownService],
    [
      'a service with variants and none chosen',
      COLOUR,
      BookingErrorCode.InvalidInput,
    ],
    [
      'a service id that names no document',
      'services/../x',
      BookingErrorCode.UnknownService,
    ],
  ])(
    'refuses %s with the commit’s own code, and records nothing',
    async (_what, serviceId, code) => {
      const { tx, run } = rig();
      const answer = await run(command(askOf(cartOf(serviceId))));
      expect(answer).toEqual({
        ok: false,
        error: WaitlistError.invalidRequest(code),
      });
      expect(tx.transactions).toEqual([]);
    },
  );
});

describe('requestWaitlist — a crafted cart costs the shop no reads', () => {
  const cap = BookingPolicy.DEFAULT.maxPartySize;

  it('refuses a party past the cap as the commit does, without reading the catalogue', async () => {
    const { reads, run } = rig();
    const answer = await run(
      command(askOf(cartOf(...Array.from({ length: cap + 1 }, () => CUT)))),
    );
    expect(answer).toEqual({
      ok: false,
      error: WaitlistError.invalidRequest(BookingErrorCode.PartyTooLarge),
    });
    // The shop is still read; no service is.
    expect(reads).toEqual([{ serviceIds: [], locationId: CENTRE }]);
  });

  it('refuses a cart naming more services than the party could ask for, without reading a service', async () => {
    const lines = Array.from(
      { length: WaitlistSystem.MAX_SERVICES_PER_PERSON * cap + 1 },
      (_, index) => ({
        lineId: CartLineId.of(`line-${index}`),
        seatKey: SeatKeyText.of('self'),
        serviceId: ServiceId.of(`svc-${index}`),
        variantId: null,
        barberId: null,
        locationId: null,
      }),
    );
    const { tx, reads, run } = rig();
    const answer = await run(
      command(
        askOf({
          cartSeats: [{ seatKey: SeatKeyText.of('self'), lines }],
          cartNextSequence: 1,
        }),
      ),
    );
    expect(answer.ok).toBe(false);
    expect(reads).toEqual([{ serviceIds: [], locationId: CENTRE }]);
    expect(tx.transactions).toEqual([]);
  });

  it('reads each named service once, inside the bounds, in one read', async () => {
    const { reads, run } = rig();
    await run(command(askOf(cartOf(CUT, CUT, 'svc-nope'))));
    expect(reads).toEqual([
      { serviceIds: [CUT, ServiceId.of('svc-nope')], locationId: CENTRE },
    ]);
  });
});

describe('requestWaitlist — the shop it names, as the commit reads it', () => {
  it.each([
    ['a shop that does not exist', 'loc-nowhere'],
    ['a shop taken off the public surface', HIDDEN],
    ['an id that names no document', 'locations/../x'],
    ['a blank id', '  '],
  ])(
    'refuses %s as the stable field `locationId`, and records nothing',
    async (_what, locationId) => {
      const { tx, run } = rig();
      const answer = await run(command(askOf(cartOf(CUT), locationId)));
      expect(answer).toEqual({
        ok: false,
        error: WaitlistError.invalidRequest('locationId'),
      });
      expect(tx.transactions).toEqual([]);
    },
  );

  it('records a request for any shop — none named, none read, on the default location’s clock (F-4)', async () => {
    const cart = cartOf(CUT);
    const { tx, reads, run } = rig();
    await run(command(askOf(cart, null)));
    expect(reads).toEqual([{ serviceIds: [CUT], locationId: null }]);
    const body = storedRequest(cart, null);
    expect(tx.plans).toEqual([
      [
        WriteOp.create(
          [
            Collections.WaitlistRequests,
            waitlistRequestIdOf(body, fixtureHash),
          ],
          body,
        ),
      ],
    ]);
  });

  it('refuses a visitor who is not signed in before reading anything', async () => {
    const { tx, reads, run } = rig();
    const answer = await run({
      ...command(askOf(cartOf(CUT))),
      ownerUserId: null,
    });
    expect(answer).toEqual({
      ok: false,
      error: WaitlistError.unauthenticated(),
    });
    expect(reads).toEqual([]);
    expect(tx.transactions).toEqual([]);
  });
});

describe('requestWaitlist — one request per meaning', () => {
  it('collapses two phrasings of one ask onto one id', async () => {
    const { run } = rig();
    const once = await run(command(askOf(cartOf(CUT))));
    const again = await rig().run(
      command({
        ...askOf(cartOf(CUT)),
        days: [
          {
            localDate: DAY,
            windows: [
              { startMinutes: 660, endMinutes: 720 },
              { startMinutes: 600, endMinutes: 660 },
            ],
          },
        ],
      }),
    );
    expect(once.ok && again.ok && once.value.requestId).toBe(
      again.ok && again.value.requestId,
    );
  });

  it('refuses a request already watched — read in the transaction — and writes nothing', async () => {
    const cart = cartOf(CUT);
    const body = storedRequest(cart, CENTRE);
    const id = waitlistRequestIdOf(body, fixtureHash);
    const { tx, run } = rig({
      stored: [{ path: [Collections.WaitlistRequests, id], body }],
    });
    const answer = await run(command(askOf(cart)));
    expect(answer).toEqual({
      ok: false,
      error: WaitlistError.alreadyWatching(),
    });
    expect(tx.plans).toEqual([]);
  });

  it('reads a lost create race as the same refusal', async () => {
    const { run } = rig({
      commit: async () =>
        Result.err(
          RepositoryError.alreadyExists(
            `${Collections.WaitlistRequests}/${WaitlistRequestId.of('wl_x')}`,
          ),
        ),
    });
    const answer = await run(command(askOf(cartOf(CUT))));
    expect(answer).toEqual({
      ok: false,
      error: WaitlistError.alreadyWatching(),
    });
  });

  it('answers a policy it cannot read, reading nothing else', async () => {
    const failure = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'unavailable',
    );
    const tx = memoryTxPorts(memoryStore());
    const run = requestWaitlist({
      ...tx,
      ...recordingTelemetry(),
      ...ZONE_PORTS,
      loadPolicy: async () => Result.err(failure),
      loadCatalog: async () => {
        throw new Error('the catalogue must not be read');
      },
    });
    expect(await run(command(askOf(cartOf(CUT))))).toEqual({
      ok: false,
      error: failure,
    });
  });

  it('places the request’s first instant on the named shop’s clock (Law 7.2)', async () => {
    const cart = cartOf(NORTH_CUT);
    const { tx, run } = rig();
    const answer = await run(command(askOf(cart, NORTH)));
    expect(answer.ok).toBe(true);
    const body = {
      ...storedRequest(cart, NORTH),
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, LONDON),
    };
    expect(tx.plans).toEqual([
      [
        WriteOp.create(
          [
            Collections.WaitlistRequests,
            waitlistRequestIdOf(body, fixtureHash),
          ],
          body,
        ),
      ],
    ]);
  });

  it('answers a zone it cannot read as its store failure, writing nothing (4A-2 (e))', async () => {
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const tx = memoryTxPorts(memoryStore());
    const run = requestWaitlist({
      ...tx,
      ...recordingTelemetry(),
      ...memoryDefaultLocationPorts(CENTRE),
      loadLocation: async () => Result.err(failed),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      loadCatalog: async () => {
        throw new Error('the catalogue must not be read');
      },
    });
    expect(await run(command(askOf(cartOf(CUT))))).toEqual(Result.err(failed));
    expect(tx.transactions).toEqual([]);
  });
});
