import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  Service,
  ServiceId,
} from '@creativo/domain/catalog';
import {
  BarberPref,
  BookingCart,
  BookingPolicy,
  CalendarDay,
  type ChairTime,
  Interval,
  SeatKey,
} from '@creativo/domain/scheduling';
import {
  ObserveDayAvailabilityUseCase,
  SCHEDULE_EXCEPTIONS_COLLECTION,
} from '@creativo/application/booking';
import { availabilityReaderBusyCases } from '@creativo/application/booking/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';

/**
 * The production reader over a Firestore stand-in: every document the
 * adapter listens to is served from `docs`, keyed by path, so what runs is
 * the adapter's own parsing, windowing and padding — the code the booking
 * grid gets in production.
 */
const { docs } = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }),
  collection: (_db: unknown, collection: string) => ({ path: collection }),
  query: (ref: { path: string }) => ref,
  where: () => null,
  onSnapshot: (
    ref: { path: string },
    onNext: (snapshot: unknown) => void,
  ): (() => void) => {
    if (!ref.path.includes('/')) {
      // A collection query — the shops' hours.
      onNext({
        docs: [...docs.entries()]
          .filter(([path]) => path.startsWith(`${ref.path}/`))
          .map(([path, data]) => ({
            id: path.slice(ref.path.length + 1),
            data: () => data,
          })),
      });
    } else {
      onNext({ data: () => docs.get(ref.path) });
    }
    return () => undefined;
  },
}));

import { FirestoreAvailabilityReader } from './availability-reader.adapter';

const ZONE = 'Europe/Sofia';
/** A Monday. */
const DAY_KEY = '2026-08-03';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const day = unwrap(CalendarDay.create(DAY_KEY, ZONE));
const ivan = unwrap(BarberId.create('ivan'));
const niko = unwrap(BarberId.create('niko'));
const center = unwrap(LocationId.create('loc-center'));

function at(hour: number, minute = 0): number {
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute },
      ZONE,
    ),
  ).toMillis();
}

function iso(ms: number): string {
  return unwrap(ZonedDateTime.fromMillis(ms, ZONE)).toISO();
}

/** Center, open 08:00–20:00 every day. */
function seedShop(): void {
  docs.set('locations/loc-center', {
    status: 'active',
    hours: Array.from({ length: 7 }, () => ({
      kind: 'open',
      opens: '08:00',
      closes: '20:00',
    })),
  });
}

/** `barberId` works Center 08:00–18:00 on Mondays, `spans` taken. */
function seedBarber(
  barberId: BarberId,
  spans: readonly Interval[],
  turnaroundMinutes: number,
): void {
  docs.set(`barberSchedules/${barberId.value}`, {
    turnaroundMinutes,
    versions: [
      {
        seq: 1,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        weeklyPattern: {
          monday: [{ start: '08:00', end: '18:00', locationId: 'loc-center' }],
        },
      },
    ],
  });
  docs.set(`barberBusy/${barberId.value}__${DAY_KEY}`, {
    busy: spans.map((span) => ({
      startIso: iso(span.startMs),
      endIso: iso(span.endMs),
      zone: ZONE,
    })),
  });
}

function reader(): FirestoreAvailabilityReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      FirestoreAvailabilityReader,
    ],
  });
  return TestBed.inject(FirestoreAvailabilityReader);
}

async function busyOf(
  barberId: BarberId,
  release?: readonly ChairTime[],
): Promise<readonly Interval[] | undefined> {
  const days = unwrap(
    await firstValueFrom(
      reader().observeDay(center, day, [ivan, niko], release),
    ),
  );
  return days.find((entry) => entry.barberId.equals(barberId))?.busy;
}

beforeEach(() => {
  docs.clear();
  seedShop();
});

describe('FirestoreAvailabilityReader.observeDay — the port’s busy contract', () => {
  it.each(
    availabilityReaderBusyCases({
      day,
      barberId: ivan,
      otherBarberId: niko,
    }).map((entry) => [entry.name, entry] as const),
  )('%s', async (_name, entry) => {
    seedBarber(ivan, entry.spans, entry.turnaroundMinutes);
    seedBarber(niko, [], 0);

    expect(await busyOf(ivan, entry.release)).toEqual(entry.busy);
  });

  it('hands back each barber’s own share of a party’s chairs, and only theirs', async () => {
    // The visit being moved: Ivan 10:00–11:00 and Niko 10:00–10:45, each
    // merged with a neighbour who follows them.
    seedBarber(ivan, [Interval.of(at(10), at(12))], 15);
    seedBarber(niko, [Interval.of(at(10), at(11, 30))], 10);
    const party: readonly ChairTime[] = [
      { barberId: ivan, occupied: Interval.of(at(10), at(11)) },
      { barberId: niko, occupied: Interval.of(at(10), at(10, 45)) },
    ];

    expect(await busyOf(ivan, party)).toEqual([
      Interval.of(at(10, 45), at(12, 15)),
    ]);
    expect(await busyOf(niko, party)).toEqual([
      Interval.of(at(10, 35), at(11, 40)),
    ]);
  });
});

/*
 * THE GRID NEVER OFFERS A SHOP `/book` DOES NOT LIST (team decision,
 * 2026-09-26): only a shop whose document is there AND `active` — the rule
 * the commit takes a new client booking by, and the waitlist's door and the
 * matcher search by. A window worked anywhere else is dropped at the
 * reader, before the engine: `buildDayWindows` reads a shop it has no hours
 * for as one that imposes NO bound, so a hidden shop (or a roster typo)
 * reached "any shop" UNCLAMPED. The stand-in serves the whole collection
 * whatever the query asks, so each document is judged by the rule itself.
 */
describe('FirestoreAvailabilityReader.observeDay — only at the shops `/book` lists', () => {
  const mladost = unwrap(LocationId.create('loc-mladost'));
  const ghost = unwrap(LocationId.create('loc-ghost'));

  /**
   * Ivan's Monday in three places: Center's morning, Mladost's afternoon
   * (Mladost, hidden, opens 14:00–17:00), and an evening at a shop nobody
   * authored — a roster typo.
   */
  function seedSplitDay(mladostStatus: string): void {
    docs.set('locations/loc-mladost', {
      status: mladostStatus,
      hours: Array.from({ length: 7 }, () => ({
        kind: 'open',
        opens: '14:00',
        closes: '17:00',
      })),
    });
    docs.set('barberSchedules/ivan', {
      turnaroundMinutes: 0,
      versions: [
        {
          seq: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern: {
            monday: [
              { start: '08:00', end: '12:00', locationId: 'loc-center' },
              { start: '13:00', end: '18:00', locationId: 'loc-mladost' },
              { start: '18:30', end: '21:00', locationId: 'loc-ghost' },
            ],
          },
        },
      ],
    });
  }

  const wallClock = (ms: number): string => iso(ms).slice(11, 16);

  /**
   * What Ivan's day offers at `locationId` (`null`: any shop) — to a new
   * booking, or to a move handing back `release`.
   */
  async function offered(
    locationId: LocationId | null,
    what: 'windows' | 'blocks' = 'windows',
    release?: readonly ChairTime[],
  ): Promise<readonly string[]> {
    const days = unwrap(
      await firstValueFrom(
        reader().observeDay(locationId, day, [ivan], release),
      ),
    );
    return days.flatMap((entry) =>
      (what === 'windows' ? entry.windows : (entry.blocks ?? [])).map(
        (window) =>
          `${window.locationId.value} ${wallClock(window.interval.startMs)}–${wallClock(window.interval.endMs)}`,
      ),
    );
  }

  it('offers "any shop" only the windows at a listed shop', async () => {
    seedSplitDay('hidden');

    expect(await offered(null)).toEqual(['loc-center 08:00–12:00']);
  });

  it('offers nothing at a hidden shop or a shop nobody authored, even named outright', async () => {
    seedSplitDay('hidden');

    expect(await offered(mladost)).toEqual([]);
    expect(await offered(ghost)).toEqual([]);
  });

  it('judges a status nobody modelled — or none — as not listed', async () => {
    seedSplitDay('archived');
    expect(await offered(null)).toEqual(['loc-center 08:00–12:00']);

    docs.set('locations/loc-mladost', {
      hours: docs.get('locations/loc-mladost')?.['hours'],
    });
    expect(await offered(null)).toEqual(['loc-center 08:00–12:00']);
  });

  it('offers the shop again once it is listed — clamped to its own hours', async () => {
    seedSplitDay('active');

    // Mladost's 13:00–18:00 shift, bounded by its 14:00–17:00 door; the
    // roster typo still offers nothing.
    expect(await offered(null)).toEqual([
      'loc-center 08:00–12:00',
      'loc-mladost 14:00–17:00',
    ]);
  });

  it('drops what a hidden shop’s day had blocked out too, with its windows', async () => {
    seedSplitDay('hidden');
    docs.set(`${SCHEDULE_EXCEPTIONS_COLLECTION}/ivan__${DAY_KEY}`, {
      barberId: 'ivan',
      dayKey: DAY_KEY,
      zone: ZONE,
      locationId: 'loc-center',
      effect: {
        kind: 'blocked',
        ranges: [
          { from: '10:00', to: '10:30' },
          { from: '15:00', to: '15:30' },
        ],
      },
    });

    expect(await offered(null)).toEqual([
      'loc-center 08:00–10:00',
      'loc-center 10:30–12:00',
    ]);
    expect(await offered(null, 'blocks')).toEqual(['loc-center 10:00–10:30']);
  });

  /*
   * …BUT A VISIT BOOKED THERE CAN STILL MOVE (team decision 2026-09-26).
   * A move names the visit's own shop and hands back its chairs; the server
   * takes such a move where the visit is (`FirestoreBookingStore.reschedule`)
   * — so the sheet offers it, still clamped to that shop's own hours.
   */
  describe('a visit being moved at a shop hidden since', () => {
    /** The visit's own chair at Mladost, 15:00–15:30, handed back. */
    const own: readonly ChairTime[] = [
      { barberId: ivan, occupied: Interval.of(at(15), at(15, 30)) },
    ];

    it('is offered its own shop — clamped to that shop’s own hours', async () => {
      seedSplitDay('hidden');

      // Mladost's 13:00–18:00 shift, bounded by its 14:00–17:00 door.
      expect(await offered(mladost, 'windows', own)).toEqual([
        'loc-mladost 14:00–17:00',
      ]);
    });

    it('is offered nothing at a shop nobody authored', async () => {
      seedSplitDay('hidden');

      expect(await offered(ghost, 'windows', own)).toEqual([]);
    });

    it('still sees listed shops only when it asks for "any shop"', async () => {
      seedSplitDay('hidden');

      expect(await offered(null, 'windows', own)).toEqual([
        'loc-center 08:00–12:00',
      ]);
    });

    it('is the ordinary booking when nothing is handed back', async () => {
      seedSplitDay('hidden');

      expect(await offered(mladost, 'windows', [])).toEqual([]);
    });
  });
});

describe('ObserveDayAvailabilityUseCase over the Firestore reader — a move', () => {
  const policy = unwrap(
    BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 0,
      horizonMonths: 2,
      maxFlexibleDays: 7,
      autoConfirm: true,
      cancellationWindowHours: 24,
    }),
  );

  /** A 60-minute cut, every shop. */
  const cut = unwrap(
    Service.create({
      id: 'svc-cut',
      name: { bg: 'Подстригване', en: 'Cut' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2500,
      currencyCode: 'EUR',
      durationMinutes: 60,
      locationIds: [],
      conflictsWith: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      offerings: [],
      status: 'active',
      sortOrder: 1,
    }),
  );

  async function startsFor(
    release?: readonly ChairTime[],
  ): Promise<readonly number[]> {
    const cart = unwrap(
      BookingCart.empty().addLine(SeatKey.self(), {
        serviceId: unwrap(ServiceId.create('svc-cut')),
        variantId: null,
        barberPref: BarberPref.specific(ivan),
      }),
    );
    const result = unwrap(
      await firstValueFrom(
        new ObserveDayAvailabilityUseCase(reader()).execute({
          cart,
          services: [cut],
          barberIds: [ivan],
          locationId: center,
          day,
          policy,
          now: unwrap(ZonedDateTime.fromMillis(at(6), ZONE)),
          ...(release ? { release } : {}),
        }),
      ),
    );
    return result.starts;
  }

  it('offers a short move over the visit’s own old chair — and keeps the neighbour’s turnaround', async () => {
    // Ivan's day: the client's own cut 10:00–11:00, somebody else's
    // 11:00–12:00, stored as one merged span; a 15-minute reset.
    seedBarber(ivan, [Interval.of(at(10), at(12))], 15);
    const own: readonly ChairTime[] = [
      { barberId: ivan, occupied: Interval.of(at(10), at(11)) },
    ];

    const kept = await startsFor();
    const released = await startsFor(own);

    // The visit colliding with itself: its padded chair keeps 09:45 onwards,
    // so the last start before it is 08:45.
    expect(kept.filter((start) => start < at(12))).toEqual([
      at(8),
      at(8, 15),
      at(8, 30),
      at(8, 45),
    ]);
    // Its own chair handed back, the server's view: up to 09:45, which ends
    // exactly where the neighbour's turnaround begins…
    expect(released.filter((start) => start < at(12))).toEqual([
      at(8),
      at(8, 15),
      at(8, 30),
      at(8, 45),
      at(9),
      at(9, 15),
      at(9, 30),
      at(9, 45),
    ]);
    // …and the afternoon is the same either way.
    expect(released.filter((start) => start >= at(12))).toEqual(
      kept.filter((start) => start >= at(12)),
    );
  });
});
