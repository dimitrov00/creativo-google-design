import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from '../testing';
import { minuteCount } from '../testing/booking-core.fixtures';
import { BarberId, LocationId } from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import { CapacityEntry } from './capacity-entry.data';

const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const d = (raw: string): LocalDate => localDate(raw);
const m = minuteCount;

const ENTRIES: readonly CapacityEntry[] = [
  CapacityEntry.of(d('2026-08-13'), IVAN, CENTER, m(60)),
  CapacityEntry.of(d('2026-08-14'), IVAN, CENTER, m(240)),
  CapacityEntry.of(d('2026-08-14'), STEFAN, CENTER, m(180)),
  CapacityEntry.of(d('2026-08-14'), STEFAN, MLADOST, m(60)),
  CapacityEntry.of(d('2026-08-15'), STEFAN, MLADOST, m(30)),
];

describe('CapacityEntry', () => {
  it('names its month document (LocalDate.monthKey) and its own key', () => {
    expect(LocalDate.monthKey(d('2026-08-14'))).toBe('2026-08');
    expect(
      CapacityEntry.keyOf(
        CapacityEntry.of(d('2026-08-14'), IVAN, CENTER, m(1)),
      ),
    ).toBe('2026-08-14|ivan|loc-center');
  });

  it('orders by day, then barber, then shop — the month document’s order', () => {
    const shuffled = [...ENTRIES].reverse();
    expect(shuffled.sort(CapacityEntry.compare)).toEqual(ENTRIES);
    expect(
      CapacityEntry.compare(
        ENTRIES[0] as CapacityEntry,
        ENTRIES[0] as CapacityEntry,
      ),
    ).toBe(0);
  });

  it('compares equal exactly when the keys are equal (property)', () => {
    const entry = fc
      .record({
        day: fc.integer({ min: 20_000, max: 20_003 }),
        barber: fc.constantFrom('ana', 'ana2', 'ivan'),
        location: fc.constantFrom('loc-a', 'loc-a2'),
      })
      .map((e) =>
        CapacityEntry.of(
          LocalDate.fromEpochDay(e.day),
          BarberId.of(e.barber),
          LocationId.of(e.location),
          m(1),
        ),
      );
    fc.assert(
      fc.property(entry, entry, (a, b) => {
        expect(CapacityEntry.compare(a, b) === 0).toBe(
          CapacityEntry.keyOf(a) === CapacityEntry.keyOf(b),
        );
        expect(
          Math.sign(CapacityEntry.compare(a, b)) +
            Math.sign(CapacityEntry.compare(b, a)),
        ).toBe(0);
      }),
    );
  });

  it('orders a barber id before its extensions — compare, not the key string, is the order', () => {
    const ana = CapacityEntry.of(
      d('2026-08-14'),
      BarberId.of('ana'),
      CENTER,
      m(1),
    );
    const ana2 = CapacityEntry.of(
      d('2026-08-14'),
      BarberId.of('ana2'),
      CENTER,
      m(1),
    );
    expect(CapacityEntry.compare(ana, ana2)).toBe(-1);
  });

  it('sums a day’s free minutes for the known barbers, optionally at one shop', () => {
    const day = d('2026-08-14');
    expect(
      CapacityEntry.freeMinutesOn(ENTRIES, day, [IVAN, STEFAN], null),
    ).toBe(480);
    expect(CapacityEntry.freeMinutesOn(ENTRIES, day, [STEFAN], null)).toBe(240);
    expect(
      CapacityEntry.freeMinutesOn(ENTRIES, day, [IVAN, STEFAN], MLADOST),
    ).toBe(60);
    expect(CapacityEntry.freeMinutesOn(ENTRIES, day, [], null)).toBe(0);
    // Absent and zero read the same.
    expect(
      CapacityEntry.freeMinutesOn(ENTRIES, d('2026-08-20'), [IVAN], null),
    ).toBe(0);
  });
});
