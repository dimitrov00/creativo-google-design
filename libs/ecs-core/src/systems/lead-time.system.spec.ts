import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CapacityEntry } from '../components/capacity-entry.data';
import { DayKey } from '../components/day-key.data';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { deepFreeze } from '../testing';
import { LeadTimeSystem } from './lead-time.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of apps/functions/src/lib/booking/sample-lead-time.spec.ts (7),
 * COPIED over the rollup's sorted entries — the legacy spec keeps running
 * against the shim (it seeds the legacy `days` map through a fake
 * Firestore; here the same days are `CapacityEntry` rows). The horizon is
 * today + 2 months under the default policy; the threshold is its 15-minute
 * slot step.
 */

const TODAY = DayKey.of('2026-08-05');
const HORIZON = DayKey.of('2026-10-05');
const STEP = 15;
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const stefan = BarberId.of('stefan');

const entry = (
  dayKey: string,
  barberId: BarberId,
  locationId: LocationId,
  minutes: number,
) => CapacityEntry.of(DayKey.of(dayKey), barberId, locationId, minutes);

const sampleFor = (entries: readonly CapacityEntry[], barberId: BarberId) =>
  LeadTimeSystem.sample(
    [...entries].sort(CapacityEntry.compare),
    barberId,
    TODAY,
    HORIZON,
    STEP,
    'Europe/Sofia',
    1_785_920_400_000,
  ).body;

describe('LeadTimeSystem — the sampled lead time', () => {
  it('reports zero lead time when the barber is free today', () => {
    const sample = sampleFor([entry(TODAY, ivan, CENTER, 240)], ivan);
    expect(sample.firstAvailableDayKey).toBe(TODAY);
    expect(sample.leadTimeDays).toBe(0);
    expect(sample.freeMinutesOnFirstDay).toBe(240);
  });

  /**
   * Same-day walk-ups are most of a barbershop's volume, so the walk starts at
   * today — but when today is full the count must be the real distance to the
   * next opening, not one.
   */
  it('counts the days to the first opening', () => {
    const sample = sampleFor(
      [entry(TODAY, ivan, CENTER, 0), entry('2026-08-07', ivan, CENTER, 90)],
      ivan,
    );
    expect(sample.firstAvailableDayKey).toBe('2026-08-07');
    expect(sample.leadTimeDays).toBe(2);
  });

  /**
   * `null`, not zero and not the horizon: "booked solid as far as we sell" is
   * a different fact from "free on the last day".
   */
  it('records null when nothing is free inside the horizon', () => {
    const sample = sampleFor([], ivan);
    expect(sample.firstAvailableDayKey).toBeNull();
    expect(sample.leadTimeDays).toBeNull();
    expect(sample.freeMinutesOnFirstDay).toBe(0);
  });

  it('ignores free time below one slot step', () => {
    const sample = sampleFor(
      [
        // 10 minutes is under the 15-minute default step — not sellable.
        entry(TODAY, ivan, CENTER, 10),
        entry('2026-08-06', ivan, CENTER, 15),
      ],
      ivan,
    );
    expect(sample.firstAvailableDayKey).toBe('2026-08-06');
  });

  it('sums a barber working two shops on one day', () => {
    const sample = sampleFor(
      [entry(TODAY, stefan, CENTER, 10), entry(TODAY, stefan, MLADOST, 10)],
      stefan,
    );
    // Neither shop clears the bar alone; the barber's own day does.
    expect(sample.firstAvailableDayKey).toBe(TODAY);
    expect(sample.freeMinutesOnFirstDay).toBe(20);
  });

  it('samples every rostered barber independently', () => {
    const entries = [
      entry(TODAY, ivan, CENTER, 60),
      entry('2026-08-06', niko, CENTER, 60),
    ];
    expect(sampleFor(entries, ivan).leadTimeDays).toBe(0);
    expect(sampleFor(entries, niko).leadTimeDays).toBe(1);
  });

  it('stamps the sample with the day it was taken', () => {
    const sample = LeadTimeSystem.sample(
      [entry(TODAY, ivan, CENTER, 60)],
      ivan,
      TODAY,
      HORIZON,
      STEP,
      'Europe/Sofia',
      1_785_920_400_000,
    );
    expect(sample.id).toBe('ivan__2026-08-05');
    expect(sample.body.dayKey).toBe(TODAY);
    expect(sample.body.barberId).toBe('ivan');
    expect(sample.body.zone).toBe('Europe/Sofia');
    expect(sample.body.horizonDayCount).toBe(62);
    expect(sample.body.sampledAtMs).toBe(1_785_920_400_000);
  });
});

describe('LeadTimeSystem — the horizon walk', () => {
  it('names every month document the span touches', () => {
    expect(LeadTimeSystem.monthKeysBetween(TODAY, HORIZON)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(
      LeadTimeSystem.monthKeysBetween(
        DayKey.of('2026-12-31'),
        DayKey.of('2027-01-01'),
      ),
    ).toEqual(['2026-12', '2027-01']);
    expect(LeadTimeSystem.monthKeysBetween(HORIZON, TODAY)).toEqual([]);
  });

  it('agrees with a day-by-day brute force (property)', () => {
    const offsets = fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: 40 }),
        fc.constantFrom(ivan, niko),
        fc.constantFrom(CENTER, MLADOST),
        fc.integer({ min: 0, max: 120 }),
      ),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(
        offsets,
        fc.integer({ min: 0, max: 60 }),
        (raw, threshold) => {
          const seen = new Set<string>();
          const entries = raw
            .map(([offset, barber, shop, minutes]) =>
              CapacityEntry.of(
                ZonedTimeSystem.addDays(TODAY, offset),
                barber,
                shop,
                minutes,
              ),
            )
            .filter((candidate) => {
              const key = CapacityEntry.keyOf(candidate);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort(CapacityEntry.compare);
          const to = ZonedTimeSystem.addDays(TODAY, 30);
          let expected = null;
          for (let day = 0; day <= 30; day++) {
            const dayKey = ZonedTimeSystem.addDays(TODAY, day);
            const free = CapacityEntry.freeMinutesOn(
              entries,
              dayKey,
              [ivan],
              null,
            );
            if (free >= threshold) {
              expected = { dayKey, leadTimeDays: day, freeMinutes: free };
              break;
            }
          }
          expect(
            LeadTimeSystem.firstAvailableDay(
              entries,
              ivan,
              TODAY,
              to,
              threshold,
            ),
          ).toEqual(expected);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const entries = deepFreeze([
      entry(TODAY, ivan, CENTER, 10),
      entry('2026-08-06', ivan, CENTER, 30),
    ]);
    const once = LeadTimeSystem.sample(
      entries,
      ivan,
      TODAY,
      HORIZON,
      STEP,
      'Europe/Sofia',
      0,
    );
    expect(
      LeadTimeSystem.sample(
        entries,
        ivan,
        TODAY,
        HORIZON,
        STEP,
        'Europe/Sofia',
        0,
      ),
    ).toEqual(once);
    expect(entries.map((e) => e.freeMinutes)).toEqual([10, 30]);
  });
});
