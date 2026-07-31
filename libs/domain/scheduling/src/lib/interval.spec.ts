import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Interval } from './interval';

/** Minutes-from-an-arbitrary-origin, so the fixtures read like a clock. */
const m = (minutes: number) => minutes * 60_000;
const iv = (startMin: number, endMin: number) =>
  Interval.of(m(startMin), m(endMin));

/** Arbitrary non-empty interval, in whole minutes within a plausible day. */
const anyInterval = fc
  .tuple(fc.integer({ min: 0, max: 1440 }), fc.integer({ min: 1, max: 240 }))
  .map(([start, length]) => iv(start, start + length));

const anyIntervals = fc.array(anyInterval, { maxLength: 12 });

describe('Interval.normalize', () => {
  it('sorts, merges overlapping runs and drops empties', () => {
    expect(
      Interval.normalize([iv(60, 90), iv(0, 30), iv(20, 40), iv(100, 100)]),
    ).toEqual([iv(0, 40), iv(60, 90)]);
  });

  it('MERGES touching intervals — as instants they are one run', () => {
    // Leaving these split would reject a 60-minute service that fits the
    // union because it fits neither half.
    expect(Interval.normalize([iv(0, 30), iv(30, 60)])).toEqual([iv(0, 60)]);
  });

  it('is idempotent and always yields a disjoint, ascending list', () => {
    fc.assert(
      fc.property(anyIntervals, (intervals) => {
        const once = Interval.normalize(intervals);
        expect(Interval.normalize(once)).toEqual(once);
        for (let i = 1; i < once.length; i++) {
          // Strictly after, and not merely touching (those merged).
          expect((once[i] as Interval).startMs).toBeGreaterThan(
            (once[i - 1] as Interval).endMs,
          );
        }
      }),
    );
  });
});

describe('Interval.subtract — the operation availability is built from', () => {
  it('cuts a hole out of the middle', () => {
    expect(Interval.subtract([iv(0, 120)], [iv(30, 60)])).toEqual([
      iv(0, 30),
      iv(60, 120),
    ]);
  });

  it('trims the leading and trailing edges', () => {
    expect(Interval.subtract([iv(0, 120)], [iv(0, 30)])).toEqual([iv(30, 120)]);
    expect(Interval.subtract([iv(0, 120)], [iv(90, 200)])).toEqual([iv(0, 90)]);
  });

  it('removes a window entirely when fully covered', () => {
    expect(Interval.subtract([iv(30, 60)], [iv(0, 120)])).toEqual([]);
  });

  it('ignores cuts that merely TOUCH — half-open, so nothing is consumed', () => {
    // A 10:45 booking does not shorten a window ending at 10:45. This is the
    // rule that lets one barber take a party's next seat immediately.
    expect(Interval.subtract([iv(0, 45)], [iv(45, 90)])).toEqual([iv(0, 45)]);
  });

  it('handles several cuts and unsorted input', () => {
    expect(
      Interval.subtract([iv(0, 240)], [iv(120, 150), iv(30, 60), iv(30, 45)]),
    ).toEqual([iv(0, 30), iv(60, 120), iv(150, 240)]);
  });

  it('never returns more minutes than it started with, and never overlaps a cut', () => {
    fc.assert(
      fc.property(anyIntervals, anyIntervals, (base, cut) => {
        const free = Interval.subtract(base, cut);
        expect(Interval.totalMinutes(free)).toBeLessThanOrEqual(
          Interval.totalMinutes(base),
        );
        for (const gap of free) {
          for (const taken of cut) {
            expect(Interval.overlaps(gap, taken)).toBe(false);
          }
        }
      }),
    );
  });

  it('subtracting nothing is a normalize', () => {
    fc.assert(
      fc.property(anyIntervals, (base) => {
        expect(Interval.subtract(base, [])).toEqual(Interval.normalize(base));
      }),
    );
  });
});

describe('Interval.intersect / union', () => {
  it('intersects overlapping runs', () => {
    expect(Interval.intersect([iv(0, 120)], [iv(60, 200)])).toEqual([
      iv(60, 120),
    ]);
  });

  it('yields nothing for disjoint or merely touching runs', () => {
    expect(Interval.intersect([iv(0, 30)], [iv(60, 90)])).toEqual([]);
    expect(Interval.intersect([iv(0, 30)], [iv(30, 60)])).toEqual([]);
  });

  it('intersects many-to-many', () => {
    expect(
      Interval.intersect([iv(0, 60), iv(120, 180)], [iv(30, 150)]),
    ).toEqual([iv(30, 60), iv(120, 150)]);
  });

  it('intersection is commutative and bounded by both sides', () => {
    fc.assert(
      fc.property(anyIntervals, anyIntervals, (a, b) => {
        const left = Interval.intersect(a, b);
        expect(Interval.intersect(b, a)).toEqual(left);
        expect(Interval.totalMinutes(left)).toBeLessThanOrEqual(
          Math.min(Interval.totalMinutes(a), Interval.totalMinutes(b)),
        );
      }),
    );
  });

  it('union covers at least as much as either side', () => {
    fc.assert(
      fc.property(anyIntervals, anyIntervals, (a, b) => {
        const total = Interval.totalMinutes(Interval.union(a, b));
        expect(total).toBeGreaterThanOrEqual(Interval.totalMinutes(a));
        expect(total).toBeGreaterThanOrEqual(Interval.totalMinutes(b));
      }),
    );
  });
});

describe('Interval.pad', () => {
  it('grows outward by the given minutes', () => {
    expect(Interval.pad(iv(60, 90), 10, 15)).toEqual(iv(50, 105));
  });

  it('padding the BUSY side is what produces a single gap, not a double one', () => {
    // A 10-minute turnaround around a 10:00–10:45 booking leaves free time
    // ending 09:50 and resuming 10:55 — one gap of 10 minutes on each side.
    // Padding the candidate as well would silently double it.
    const busy = Interval.pad(iv(600, 645), 10, 10);
    expect(Interval.subtract([iv(540, 720)], [busy])).toEqual([
      iv(540, 590),
      iv(655, 720),
    ]);
  });
});

describe('Interval.totalMinutes', () => {
  it('never double-counts overlapping input', () => {
    expect(Interval.totalMinutes([iv(0, 60), iv(30, 90)])).toBe(90);
  });

  it('is zero for empty input', () => {
    expect(Interval.totalMinutes([])).toBe(0);
  });
});
