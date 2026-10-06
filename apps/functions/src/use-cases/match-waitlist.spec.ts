import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Firestore } from 'firebase-admin/firestore';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import {
  BookingPolicy,
  CalendarDay,
  WaitlistRequest,
} from '@creativo/domain/scheduling';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { FixedClock } from '../test-support/fixed-clock';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import { loadDayAvailability } from '../lib/booking/load-day-availability';
import { CommitBookingUseCase } from './commit-booking.use-case';
import type { RequestedSeat } from './decide-booking';
import { type WaitlistMatch, matchWaitlist } from './match-waitlist';

/**
 * A WAITLIST NOTIFICATION IS A PROMISE: it may name only a start the booking
 * path accepts for that request right then.
 *
 * So every spec here runs the production path end to end over one Firestore
 * stand-in: the trigger's read (`loadDayAvailability`), the decision
 * (`matchWaitlist`), and then the commit the notified client would make
 * (`CommitBookingUseCase` over `FirestoreBookingStore`, deciding with
 * `decideBooking`). A match the commit refuses is the bug; a time the commit
 * refuses is shown refused, so each "nothing" below is the right answer and
 * not merely a quiet one.
 */

const ZONE = 'Europe/Sofia';
const OWNER = 'user-waiting';
/** A Tuesday. */
const DAY_KEY = '2030-01-15';
/** Two days before — inside the lead time and the horizon both. */
const NOW_ISO = '2030-01-13T08:00:00.000+02:00';
const POLICY = BookingPolicy.default();

const CENTER = 'loc-center';
const MLADOST = 'loc-mladost';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const day = unwrap(CalendarDay.create(DAY_KEY, ZONE));

/** `HH:MM` on the day → an instant. */
function at(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2030, month: 1, day: 15, hour: hour ?? 0, minute: minute ?? 0 },
      ZONE,
    ),
  ).toMillis();
}

function iso(ms: number): string {
  return unwrap(ZonedDateTime.fromMillis(ms, ZONE)).toISO();
}

function wallClock(ms: number): string {
  return iso(ms).slice(11, 16);
}

// ── The shop ──────────────────────────────────────────────────────────────

interface Segment {
  readonly start: string;
  readonly end: string;
  readonly locationId: string;
}

interface BarberSeed {
  readonly id: string;
  /** Tuesday's roster. Empty ⇒ not rostered on the day. */
  readonly segments: readonly Segment[];
  readonly turnaroundMinutes?: number;
  /** `[from, to]` wall-clock spans, UNPADDED, as the projection stores them. */
  readonly busy?: readonly (readonly [string, string])[];
}

const works = (locationId: string, start = '09:00', end = '18:00') => [
  { start, end, locationId },
];

function serviceDoc(input: {
  readonly name: string;
  readonly durationMinutes: number;
  readonly setupMinutes?: number;
  readonly cleanupMinutes?: number;
  /** Empty ⇒ every shop, the catalog's own reading. */
  readonly locationIds: readonly string[];
}): Record<string, unknown> {
  return {
    name: { bg: input.name, en: input.name },
    description: { bg: '—', en: '—' },
    categoryId: 'cat-hair',
    priceMinorUnits: 2500,
    currencyCode: 'EUR',
    durationMinutes: input.durationMinutes,
    setupMinutes: input.setupMinutes ?? 0,
    cleanupMinutes: input.cleanupMinutes ?? 0,
    locationIds: input.locationIds,
    conflictsWith: [],
    variants: [],
    offerings: [],
    composition: { kind: 'single' },
    upsellOnly: false,
    popular: false,
    status: 'active',
    sortOrder: 1,
  };
}

const openAllWeek = Array.from({ length: 7 }, () => ({
  kind: 'open',
  opens: '08:00',
  closes: '20:00',
}));

/**
 * Two shops open 08:00–20:00, and a catalog of three services: a cut both
 * shops offer, a royal shave only Center offers (with cleanup), and a beard
 * trim only Mladost offers (with setup) — plus one the shop has retired.
 */
function seeded(barbers: readonly BarberSeed[]): Firestore {
  const seed: Record<string, Record<string, unknown>> = {
    [`locations/${CENTER}`]: {
      timezone: ZONE,
      status: 'active',
      hours: openAllWeek,
    },
    [`locations/${MLADOST}`]: {
      timezone: ZONE,
      status: 'active',
      hours: openAllWeek,
    },
    'services/svc-cut': serviceDoc({
      name: 'Cut',
      durationMinutes: 30,
      locationIds: [],
    }),
    'services/svc-royal': serviceDoc({
      name: 'Royal shave',
      durationMinutes: 45,
      cleanupMinutes: 10,
      locationIds: [CENTER],
    }),
    'services/svc-beard': serviceDoc({
      name: 'Beard',
      durationMinutes: 20,
      setupMinutes: 5,
      locationIds: [MLADOST],
    }),
    // Retired since the request was made: neither read loads it.
    'services/svc-retired': {
      ...serviceDoc({ name: 'Retired', durationMinutes: 30, locationIds: [] }),
      status: 'archived',
    },
  };
  for (const barber of barbers) {
    seed[`barbers/${barber.id}`] = { status: 'active' };
    seed[`barberSchedules/${barber.id}`] = {
      barberId: barber.id,
      turnaroundMinutes: barber.turnaroundMinutes ?? 0,
      versions: [
        {
          seq: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern:
            barber.segments.length === 0 ? {} : { tuesday: barber.segments },
        },
      ],
    };
    if (barber.busy && barber.busy.length > 0) {
      seed[`barberBusy/${barber.id}__${DAY_KEY}`] = {
        barberId: barber.id,
        dayKey: DAY_KEY,
        zone: ZONE,
        busy: barber.busy.map(([from, to]) => ({
          startIso: iso(at(from)),
          endIso: iso(at(to)),
          zone: ZONE,
        })),
      };
    }
  }
  return createProjectionFirestore(seed).db as unknown as Firestore;
}

// ── The request, the match, the commit ────────────────────────────────────

interface Ask {
  readonly locationId: string | null;
  /** One line per seat; `barberId` is a specific preference, absent is any. */
  readonly seats: readonly {
    readonly seatKey: string;
    readonly serviceId: string;
    readonly barberId?: string | null;
  }[];
  readonly windows: readonly { readonly from: string; readonly to: string }[];
}

function requestFor(ask: Ask): WaitlistRequest {
  return unwrap(
    WaitlistRequest.create({
      id: 'wl-1',
      ownerId: OWNER,
      locationId: ask.locationId,
      when: { days: [{ dayKey: DAY_KEY, windows: ask.windows }] },
      cart: {
        seats: ask.seats.map((seat, index) => ({
          seatKey: seat.seatKey,
          lines: [
            {
              id: `line-${index}`,
              serviceId: seat.serviceId,
              variantId: null,
              barberId: seat.barberId ?? null,
            },
          ],
        })),
        nextSequence: ask.seats.length,
      },
      status: 'open',
      createdAtIso: NOW_ISO,
      zone: ZONE,
    }),
  );
}

/** What the trigger decides for this request, from what it reads. */
async function matchIn(
  db: Firestore,
  request: WaitlistRequest,
  nowIso = NOW_ISO,
  policy: BookingPolicy = POLICY,
): Promise<WaitlistMatch | null> {
  const snapshot = await loadDayAvailability(db, day, ZONE);
  return matchWaitlist(request, day, snapshot, {
    now: unwrap(ZonedDateTime.fromISO(nowIso, ZONE)),
    policy,
  });
}

/**
 * The seats the notified client commits, built from the match the way the
 * booking flow builds them from a picked option (`BookingFlowStore`): each
 * assignment's line, barber and sold start, the preference the line carried.
 */
function seatsOf(
  request: WaitlistRequest,
  match: WaitlistMatch,
): readonly RequestedSeat[] {
  const byLine = new Map(
    request.cart.seats.flatMap((seat) =>
      seat.lines.map((line) => [line.id, { seatKey: seat.seatKey, line }]),
    ),
  );
  // The promise is for the WHOLE party: a line the match leaves unplaced is
  // a visit nobody asked for.
  const placed = new Set(match.assignments.map((entry) => entry.lineId));
  const unplaced = [...byLine.keys()].filter((lineId) => !placed.has(lineId));
  if (unplaced.length > 0) {
    throw new Error(`the match leaves ${unplaced.join(', ')} unplaced`);
  }
  return match.assignments.map((assignment): RequestedSeat => {
    const found = byLine.get(assignment.lineId);
    if (!found) throw new Error(`no cart line ${assignment.lineId}`);
    return {
      lineId: assignment.lineId,
      serviceId: found.line.serviceId,
      variantId: found.line.variantId,
      barberId: assignment.barberId.value,
      barberPref: found.line.barberId === null ? 'any' : 'specific',
      startIso: iso(assignment.slot.startMs),
      subject:
        found.seatKey === 'self'
          ? { kind: 'self' }
          : { kind: 'guest', label: found.seatKey, guestKey: found.seatKey },
    };
  });
}

/** One seat, by hand: the time a pool-blind matcher would have promised. */
function seat(input: {
  readonly lineId?: string;
  readonly serviceId: string;
  readonly barberId: string;
  readonly at: string;
  readonly seatKey?: string;
}): RequestedSeat {
  const seatKey = input.seatKey ?? 'self';
  return {
    lineId: input.lineId ?? 'line-0',
    serviceId: input.serviceId,
    variantId: null,
    barberId: input.barberId,
    barberPref: 'any',
    startIso: iso(at(input.at)),
    subject:
      seatKey === 'self'
        ? { kind: 'self' }
        : { kind: 'guest', label: seatKey, guestKey: seatKey },
  };
}

/** `commitBooking` for this owner: `'committed'`, or the refusal's code. */
async function commit(
  db: Firestore,
  locationId: string,
  seats: readonly RequestedSeat[],
  nowIso = NOW_ISO,
  policy: BookingPolicy = POLICY,
): Promise<string> {
  let next = 0;
  const result = await new CommitBookingUseCase(
    new FirestoreBookingStore(db),
    new FixedClock(nowIso),
    { next: () => `id-${next++}` },
    policy,
  ).execute({ locationId, seats, ownerUserId: OWNER });
  return result.isSuccess() ? 'committed' : result.error.code;
}

/** The match in words, and whether the commit then takes it. */
async function promised(
  db: Firestore,
  request: WaitlistRequest,
): Promise<{
  readonly at: string;
  readonly locationId: string;
  readonly barbers: readonly string[];
  readonly commit: string;
} | null> {
  const found = await matchIn(db, request);
  if (!found) return null;
  return {
    at: wallClock(found.startMs),
    locationId: found.locationId.value,
    barbers: found.barberIds.map((id) => id.value),
    commit: await commit(db, found.locationId.value, seatsOf(request, found)),
  };
}

// ── The promise, case by case ─────────────────────────────────────────────

describe('matchWaitlist — a notification the booking path keeps', () => {
  it('sends a start the commit accepts, at the shop the request named', async () => {
    const db = seeded([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '10:30']] },
    ]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '12:00' }],
    });

    expect(await promised(db, request)).toEqual({
      at: '10:30',
      locationId: CENTER,
      barbers: ['ivan'],
      commit: 'committed',
    });
  });

  it('sends nothing at a shop that does not offer the service', async () => {
    // Center offers the royal shave and is full; Mladost is empty and does
    // not offer it. A pool of every shop's barbers placed it with Niko.
    const db = seeded([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '12:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-royal' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });

    expect(await matchIn(db, request)).toBeNull();
    // …which is the commit's answer too.
    expect(
      await commit(db, MLADOST, [
        seat({ serviceId: 'svc-royal', barberId: 'niko', at: '10:00' }),
      ]),
    ).toBe('booking.commit.service_not_at_location');
  });

  it('still sends it once the shop that offers it frees up', async () => {
    const db = seeded([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '10:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-royal' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });

    expect(await promised(db, request)).toEqual({
      at: '10:00',
      locationId: CENTER,
      barbers: ['ivan'],
      commit: 'committed',
    });
  });

  it('sends nothing at a shop the request did not name', async () => {
    const db = seeded([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '12:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const atCenter = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });

    expect(await matchIn(db, atCenter)).toBeNull();
    // Niko's free morning is at Mladost; a Center booking with him is
    // refused.
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'niko', at: '10:00' }),
      ]),
    ).toBe('booking.commit.barber_not_rostered');
  });

  it('sends the other shop’s time when the request named that shop, or none', async () => {
    const world = (): Firestore =>
      seeded([
        { id: 'ivan', segments: works(CENTER), busy: [['09:00', '12:00']] },
        { id: 'niko', segments: works(MLADOST) },
      ]);
    const expected = {
      at: '10:00',
      locationId: MLADOST,
      barbers: ['niko'],
      commit: 'committed',
    };

    for (const locationId of [MLADOST, null]) {
      const request = requestFor({
        locationId,
        seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
        windows: [{ from: '10:00', to: '11:00' }],
      });
      expect(await promised(world(), request)).toEqual(expected);
    }
  });

  it('sends nothing that splits a party across two shops', async () => {
    // One free chair at each shop, and half an hour: the father and the son
    // fit only side by side, and side by side is two shops.
    const db = seeded([
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

    expect(await matchIn(db, request)).toBeNull();
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' }),
        seat({
          lineId: 'line-1',
          serviceId: 'svc-cut',
          barberId: 'niko',
          at: '10:00',
          seatKey: 'guest-1',
        }),
      ]),
    ).toBe('booking.commit.barber_not_rostered');
  });

  it('sends the party side by side at one shop with two free chairs', async () => {
    const db = seeded([
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

    const sent = await promised(db, request);
    expect(sent).toMatchObject({
      at: '10:00',
      locationId: CENTER,
      commit: 'committed',
    });
    expect([...(sent?.barbers ?? [])].sort()).toEqual(['ivan', 'petar']);
  });

  it('sends nothing inside the barber’s turnaround', async () => {
    // Ivan resets for 15 minutes after the 10:00–11:00 visit: 11:00 is his
    // reset, not a free chair.
    const db = seeded([
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

    expect(await matchIn(db, request)).toBeNull();
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '11:00' }),
      ]),
    ).toBe('booking.commit.slot_unavailable');
  });

  it('sends the first start after the turnaround', async () => {
    const db = seeded([
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

    expect(await promised(db, request)).toEqual({
      at: '11:15',
      locationId: CENTER,
      barbers: ['ivan'],
      commit: 'committed',
    });
  });

  it('keeps to the barber the request asked for', async () => {
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut', barberId: 'niko' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });

    const nikoBusy = seeded([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'niko', segments: works(MLADOST), busy: [['09:00', '12:00']] },
    ]);
    expect(await matchIn(nikoBusy, request)).toBeNull();

    const nikoFree = seeded([
      { id: 'ivan', segments: works(CENTER) },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    expect(await promised(nikoFree, request)).toEqual({
      at: '10:00',
      locationId: MLADOST,
      barbers: ['niko'],
      commit: 'committed',
    });
  });

  it('sends nothing for part of a party whose other service left the catalog', async () => {
    const db = seeded([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [
        { seatKey: 'self', serviceId: 'svc-cut' },
        { seatKey: 'guest-1', serviceId: 'svc-retired' },
      ],
      windows: [{ from: '10:00', to: '12:00' }],
    });

    expect(await matchIn(db, request)).toBeNull();
    // The grid drops the retired line and would place the cut alone; the
    // commit refuses the party it was asked for.
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' }),
        seat({
          lineId: 'line-1',
          serviceId: 'svc-retired',
          barberId: 'ivan',
          at: '10:30',
          seatKey: 'guest-1',
        }),
      ]),
    ).toBe('booking.commit.unknown_service');
  });

  it('sends nothing past the booking horizon', async () => {
    // Two months ahead of 1 October is 1 December: the 15th of January is
    // not bookable yet, whatever the chairs say.
    const earlyIso = '2029-10-01T08:00:00.000+03:00';
    const db = seeded([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });

    expect(await matchIn(db, request, earlyIso)).toBeNull();
    expect(
      await commit(
        db,
        CENTER,
        [seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' })],
        earlyIso,
      ),
    ).toBe('booking.commit.beyond_horizon');
  });
});

// ── The catalogue, changed since the request ──────────────────────────────

/*
 * A REQUEST WAS ADMITTED WHEN IT WAS MADE; THE CATALOGUE CAN CHANGE SINCE
 * (round 6). The matcher asks the commit's own admission again
 * (`cartAdmissible`) before every notification: a service that gained
 * variants, two services that now conflict, a party cap the owner lowered —
 * each makes the commit refuse every start, so none is a promise. Each case
 * shows the same request matched BEFORE the change, so the silence after it
 * is the drift's doing.
 */
describe('matchWaitlist — sends nothing the catalogue no longer lets the commit keep', () => {
  /** Rewrite one service document, as the owner's catalogue edit does. */
  async function edit(
    db: Firestore,
    serviceId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await db.collection('services').doc(serviceId).update(patch);
  }

  it('sends nothing once a service the request names gained variants', async () => {
    const db = seeded([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(await matchIn(db, request)).not.toBeNull();

    await edit(db, 'svc-cut', {
      variants: [
        { id: 'short', name: { bg: 'Къса', en: 'Short' } },
        { id: 'long', name: { bg: 'Дълга', en: 'Long' } },
      ],
    });

    expect(await matchIn(db, request)).toBeNull();
    // The line chose no variant, and the commit now needs one.
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' }),
      ]),
    ).toBe('booking.commit.invalid_input');
  });

  it('sends nothing once two services one person asked for conflict', async () => {
    const db = seeded([{ id: 'ivan', segments: works(CENTER) }]);
    // ONE person, two services, one after the other.
    const request = unwrap(
      WaitlistRequest.create({
        id: 'wl-1',
        ownerId: OWNER,
        locationId: CENTER,
        when: {
          days: [
            { dayKey: DAY_KEY, windows: [{ from: '10:00', to: '12:00' }] },
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
                  barberId: null,
                },
                {
                  id: 'line-1',
                  serviceId: 'svc-royal',
                  variantId: null,
                  barberId: null,
                },
              ],
            },
          ],
          nextSequence: 2,
        },
        status: 'open',
        createdAtIso: NOW_ISO,
        zone: ZONE,
      }),
    );
    expect(await matchIn(db, request)).not.toBeNull();

    await edit(db, 'svc-royal', { conflictsWith: ['svc-cut'] });

    expect(await matchIn(db, request)).toBeNull();
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' }),
        seat({
          lineId: 'line-1',
          serviceId: 'svc-royal',
          barberId: 'ivan',
          at: '10:30',
        }),
      ]),
    ).toBe('booking.commit.conflicting_services');
  });

  it('sends nothing to a party over a cap the owner lowered', async () => {
    const lowered = unwrap(
      BookingPolicy.create({
        maxPartySize: 1,
        slotStepMinutes: POLICY.slotStepMinutes,
        minLeadMinutes: POLICY.minLeadMinutes,
        horizonMonths: POLICY.horizonMonths,
        cancellationWindowHours: 24,
        maxFlexibleDays: POLICY.maxFlexibleDays,
        autoConfirm: true,
      }),
    );
    const db = seeded([
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
    expect(await matchIn(db, request)).not.toBeNull();

    expect(await matchIn(db, request, NOW_ISO, lowered)).toBeNull();
    expect(
      await commit(
        db,
        CENTER,
        [
          seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' }),
          seat({
            lineId: 'line-1',
            serviceId: 'svc-cut',
            barberId: 'petar',
            at: '10:00',
            seatKey: 'guest-1',
          }),
        ],
        NOW_ISO,
        lowered,
      ),
    ).toBe('booking.commit.party_too_large');
  });
});

// ── The shop, hidden since the request ────────────────────────────────────

/*
 * A REQUEST NAMED A SHOP THE COMMIT WOULD ACCEPT; THE OWNER CAN HIDE IT SINCE
 * (team decision, 2026-09-26). The matcher reads each shop through the
 * commit's own reading of it (`toShop`, `loadDayAvailability`) and searches
 * only the ones `/book` lists — the shops the commit takes a new client
 * booking at (`shopListed`) — so a request naming a hidden shop is SKIPPED —
 * no match, so the trigger writes nothing and the request stays `open`. Not
 * closed: `hidden` is reversible, and the request is told again once the
 * shop is back; it lapses as every request does when its days pass. Each
 * case shows the same request matched BEFORE the change, so the silence
 * after it is the shop's doing.
 */
describe('matchWaitlist — searches only the shops `/book` lists', () => {
  async function setShopStatus(
    db: Firestore,
    locationId: string,
    status: string,
  ): Promise<void> {
    await db.collection('locations').doc(locationId).update({ status });
  }

  it('skips a request whose shop was hidden since — and matches it again once the shop is back', async () => {
    const db = seeded([{ id: 'ivan', segments: works(CENTER) }]);
    const request = requestFor({
      locationId: CENTER,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect(await matchIn(db, request)).not.toBeNull();

    await setShopStatus(db, CENTER, 'hidden');
    expect(await matchIn(db, request)).toBeNull();
    // The silence is the commit's answer too: a hidden shop takes no new
    // client booking (the store's own spec holds the whole rule).
    expect(
      await commit(db, CENTER, [
        seat({ serviceId: 'svc-cut', barberId: 'ivan', at: '10:00' }),
      ]),
    ).toBe('booking.commit.invalid_input');

    await setShopStatus(db, CENTER, 'active');
    expect(await promised(db, request)).toEqual({
      at: '10:00',
      locationId: CENTER,
      barbers: ['ivan'],
      commit: 'committed',
    });
  });

  it('never tells an any-shop request of a slot at a hidden shop', async () => {
    // Center is full; Mladost's free morning is the only answer — until
    // Mladost is hidden.
    const db = seeded([
      { id: 'ivan', segments: works(CENTER), busy: [['09:00', '18:00']] },
      { id: 'niko', segments: works(MLADOST) },
    ]);
    const request = requestFor({
      locationId: null,
      seats: [{ seatKey: 'self', serviceId: 'svc-cut' }],
      windows: [{ from: '10:00', to: '11:00' }],
    });
    expect((await matchIn(db, request))?.locationId.value).toBe(MLADOST);

    await setShopStatus(db, MLADOST, 'hidden');

    expect(await matchIn(db, request)).toBeNull();
  });
});

// ── The promise, as a property ────────────────────────────────────────────

describe('matchWaitlist — every match is a booking the commit accepts', () => {
  const BARBERS = ['ivan', 'niko', 'petar'] as const;
  const SHOPS = [null, CENTER, MLADOST] as const;
  const SERVICES = [
    'svc-cut',
    'svc-royal',
    'svc-beard',
    'svc-retired',
  ] as const;

  /** Minutes after 09:00 → `HH:MM`. */
  const clock = (minutes: number): string => {
    const total = 9 * 60 + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const roster = fc.constantFrom<readonly Segment[]>(
    works(CENTER),
    works(MLADOST),
    // One day, two shops: a Center morning and a Mladost afternoon.
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

  const ask = fc.record({
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
        lines.map((line, index) => ({
          ...line,
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

  // A generous timeout: each run seeds a store, reads a day and commits.
  // Seconds alone, but a whole-project run shares the machine with every
  // other suite.
  it('holds over random rosters, turnarounds, busy days and requests', async () => {
    let sent = 0;
    await fc.assert(
      fc.asyncProperty(world, ask, async (barbers, wanted) => {
        const db = seeded(barbers);
        const request = requestFor(wanted);
        const found = await matchIn(db, request);
        if (!found) return;
        sent++;

        if (wanted.locationId !== null) {
          expect(found.locationId.value).toBe(wanted.locationId);
        }
        // A SPECIFIC barber the request asked for is the barber the match
        // names. The commit below cannot tell: `seatsOf` hands it the
        // ASSIGNED barber as `specific`, so a match that ignored the
        // request would still commit.
        const lineOf = new Map(
          request.cart.seats.flatMap((entry) =>
            entry.lines.map((line) => [line.id, line] as const),
          ),
        );
        for (const assignment of found.assignments) {
          const line = lineOf.get(assignment.lineId);
          if (line !== undefined && line.barberId !== null) {
            expect(assignment.barberId.value).toBe(line.barberId);
          }
        }
        expect(
          await commit(db, found.locationId.value, seatsOf(request, found)),
        ).toBe('committed');
      }),
      { numRuns: 250 },
    );
    // Not vacuous: plenty of the random days did send something (about one
    // in six, so fifteen is far below what any seed produces).
    expect(sent).toBeGreaterThan(15);
  }, 60_000);
});
