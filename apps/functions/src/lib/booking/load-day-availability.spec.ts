import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { BarberId } from '@creativo/domain/catalog';
import { CalendarDay, Interval } from '@creativo/domain/scheduling';
import { BarberId as BarberKey, DayKey } from '@creativo/ecs-core';
import { schedulingPortsContract } from '@creativo/ecs-core/testing';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { loadDayAvailability } from './load-day-availability';

/**
 * The matcher's read of a day, over a Firestore stand-in: what runs is the
 * loader's own parsing, windowing and padding — the snapshot every waitlist
 * notification is decided from.
 *
 * Its `busy` is held to the SAME contract as the scheduling ports
 * (`schedulingPortsContract`, `@creativo/ecs-core/testing` — the successor
 * of the grid reader's `availabilityReaderBusyCases`): `paddedBusy` of the
 * stored spans and the roster's turnaround. Each case's spans are seeded in
 * this loader's own wire shape. A waitlist request is a new booking, never a
 * move, so only the cases that hand nothing back apply.
 */

const ZONE = 'Europe/Sofia';
/** A Tuesday. */
const DAY_KEY = '2030-01-15';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const day = unwrap(CalendarDay.create(DAY_KEY, ZONE));
const ivan = unwrap(BarberId.create('ivan'));
const niko = unwrap(BarberId.create('niko'));

function at(hour: number, minute = 0): number {
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2030, month: 1, day: 15, hour, minute },
      ZONE,
    ),
  ).toMillis();
}

function iso(ms: number): string {
  return unwrap(ZonedDateTime.fromMillis(ms, ZONE)).toISO();
}

interface SeededBarber {
  readonly id: string;
  readonly turnaroundMinutes: number;
  /** The `barberBusy` spans, UNPADDED, as the projection stores them. */
  readonly spans: readonly Interval[];
}

/**
 * Center, open 08:00–20:00 every day; one active service; every barber
 * working Center 08:00–18:00 on Tuesdays.
 */
function seeded(barbers: readonly SeededBarber[]): Firestore {
  const seed: Record<string, Record<string, unknown>> = {
    'locations/loc-center': {
      timezone: ZONE,
      status: 'active',
      hours: Array.from({ length: 7 }, () => ({
        kind: 'open',
        opens: '08:00',
        closes: '20:00',
      })),
    },
    'services/svc-cut': {
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
    },
  };
  for (const barber of barbers) {
    seed[`barbers/${barber.id}`] = { status: 'active' };
    seed[`barberSchedules/${barber.id}`] = {
      barberId: barber.id,
      turnaroundMinutes: barber.turnaroundMinutes,
      versions: [
        {
          seq: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern: {
            tuesday: [
              { start: '08:00', end: '18:00', locationId: 'loc-center' },
            ],
          },
        },
      ],
    };
    seed[`barberBusy/${barber.id}__${DAY_KEY}`] = {
      barberId: barber.id,
      dayKey: DAY_KEY,
      zone: ZONE,
      busy: barber.spans.map((span) => ({
        startIso: iso(span.startMs),
        endIso: iso(span.endMs),
        zone: ZONE,
      })),
    };
  }
  return createProjectionFirestore(seed).db as unknown as Firestore;
}

async function busyOf(
  db: Firestore,
  barberId: BarberId,
): Promise<readonly Interval[] | undefined> {
  const snapshot = await loadDayAvailability(db, day, ZONE);
  return snapshot.barbers.find((entry) => entry.barberId.equals(barberId))
    ?.busy;
}

describe('loadDayAvailability — the port’s busy contract', () => {
  // A waitlist request is a new booking: nothing is ever handed back.
  const cases = schedulingPortsContract({
    dayKey: DayKey.of(DAY_KEY),
    zone: ZONE,
    barberId: BarberKey.of(ivan.value),
    otherBarberId: BarberKey.of(niko.value),
  }).cases.filter((entry) => (entry.release ?? []).length === 0);

  it('runs the contract’s cases that hand nothing back', () => {
    // A contract that grew or lost a release-free case should be noticed,
    // not silently skipped by the filter above.
    expect(cases.map((entry) => entry.name)).toEqual([
      'nothing handed back: every span padded by the turnaround',
      'an empty release is the ordinary booking',
    ]);
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))(
    '%s',
    async (_name, entry) => {
      const db = seeded([
        {
          id: 'ivan',
          turnaroundMinutes: entry.turnaroundMinutes,
          spans: entry.spans,
        },
        { id: 'niko', turnaroundMinutes: 0, spans: [] },
      ]);

      expect(await busyOf(db, ivan)).toEqual(entry.busy);
    },
  );

  it('pads each barber by their OWN turnaround, and merges what padding joins', async () => {
    const db = seeded([
      // 10:00–10:30 and 10:45–11:15 — fifteen minutes apart, and a 10-minute
      // reset on each side closes the gap.
      {
        id: 'ivan',
        turnaroundMinutes: 10,
        spans: [
          Interval.of(at(10), at(10, 30)),
          Interval.of(at(10, 45), at(11, 15)),
        ],
      },
      {
        id: 'niko',
        turnaroundMinutes: 5,
        spans: [Interval.of(at(9), at(9, 30))],
      },
    ]);

    expect(await busyOf(db, ivan)).toEqual([
      Interval.of(at(9, 50), at(11, 25)),
    ]);
    expect(await busyOf(db, niko)).toEqual([Interval.of(at(8, 55), at(9, 35))]);
  });

  it('leaves a barber with no turnaround on the roster unpadded', async () => {
    const db = seeded([
      {
        id: 'ivan',
        turnaroundMinutes: 0,
        spans: [Interval.of(at(10), at(11))],
      },
    ]);

    expect(await busyOf(db, ivan)).toEqual([Interval.of(at(10), at(11))]);
  });
});

/*
 * THE MATCHER SEARCHES ONLY SHOPS `/book` LISTS (team decision, 2026-09-26).
 * Each shop is read through the commit's own reading of it (`toShop`), and a
 * window at a shop the searched set does not hold — hidden since, or a
 * roster naming a shop that is not there — is dropped, as the capacity plan
 * drops it. `buildDayWindows` alone reads such a shop as "publishes no
 * bound", which searched its chairs unclamped.
 */
describe('loadDayAvailability — only the shops the public surface lists', () => {
  const openAllDay = Array.from({ length: 7 }, () => ({
    kind: 'open',
    opens: '08:00',
    closes: '20:00',
  }));

  function seededShops(
    rosters: Record<string, readonly Record<string, string>[]>,
  ): Firestore {
    const seed: Record<string, Record<string, unknown>> = {
      'locations/loc-center': {
        timezone: ZONE,
        status: 'active',
        hours: openAllDay,
      },
      'locations/loc-mladost': {
        timezone: ZONE,
        status: 'hidden',
        hours: openAllDay,
      },
      'services/svc-cut': {
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
      },
    };
    for (const [id, tuesday] of Object.entries(rosters)) {
      seed[`barbers/${id}`] = { status: 'active' };
      seed[`barberSchedules/${id}`] = {
        barberId: id,
        turnaroundMinutes: 0,
        versions: [
          {
            seq: 1,
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            weeklyPattern: { tuesday },
          },
        ],
      };
    }
    return createProjectionFirestore(seed).db as unknown as Firestore;
  }

  async function windowsOf(db: Firestore) {
    const snapshot = await loadDayAvailability(db, day, ZONE);
    return new Map(
      snapshot.barbers.map((barber) => [
        barber.barberId.value,
        barber.windows.map(
          (window) =>
            `${window.locationId.value} ${iso(window.interval.startMs).slice(11, 16)}–${iso(window.interval.endMs).slice(11, 16)}`,
        ),
      ]),
    );
  }

  it('keeps a split day’s hours at the listed shop and drops the hidden one’s', async () => {
    const db = seededShops({
      ivan: [
        { start: '09:00', end: '12:00', locationId: 'loc-center' },
        { start: '13:00', end: '18:00', locationId: 'loc-mladost' },
      ],
    });

    expect((await windowsOf(db)).get('ivan')).toEqual([
      'loc-center 09:00–12:00',
    ]);
  });

  it('leaves out a barber who works only at a hidden shop that day', async () => {
    const db = seededShops({
      ivan: [{ start: '09:00', end: '18:00', locationId: 'loc-center' }],
      niko: [{ start: '09:00', end: '18:00', locationId: 'loc-mladost' }],
    });

    expect([...(await windowsOf(db)).keys()]).toEqual(['ivan']);
  });

  it('leaves out a roster naming a shop that is not there, rather than searching it unclamped', async () => {
    const db = seededShops({
      ivan: [{ start: '09:00', end: '18:00', locationId: 'loc-center' }],
      petar: [{ start: '06:00', end: '23:00', locationId: 'loc-typo' }],
    });

    expect([...(await windowsOf(db)).keys()]).toEqual(['ivan']);
  });

  /*
   * NOTHING TO SEARCH IS AN ANSWER, NOT A FAILURE. The trigger reads each
   * watching request's lapse after this load; a `null` for "nothing to
   * search" skipped that, and a one-shop tenant whose shop is hidden has
   * nothing to search on any day.
   */
  it('reads a day whose every shop is hidden as an empty day, never `null`', async () => {
    const db = seededShops({
      ivan: [{ start: '09:00', end: '18:00', locationId: 'loc-center' }],
    });
    await db
      .collection('locations')
      .doc('loc-center')
      .update({ status: 'hidden' });

    const snapshot = await loadDayAvailability(db, day, ZONE);

    expect(snapshot).not.toBeNull();
    expect(snapshot.zone).toBe(ZONE);
    expect(snapshot.barbers).toEqual([]);
  });

  it('reads a day nobody is rostered on as an empty day too', async () => {
    const db = seededShops({ ivan: [] });

    const snapshot = await loadDayAvailability(db, day, ZONE);

    expect(snapshot).not.toBeNull();
    expect(snapshot.barbers).toEqual([]);
  });
});
