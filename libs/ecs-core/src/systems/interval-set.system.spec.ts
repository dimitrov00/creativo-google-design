import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MinuteRange } from '@core/components';
import { IntervalSetSystem } from './interval-set.system';
import { MinuteCount } from '@core/primitives';
import { unwrapOk as okOf, deepFreeze } from '@core/testing';

const count = (n: number): MinuteCount => okOf(MinuteCount.of(n));

/*
 * The cases of the legacy scheduling `interval.spec.ts` (deleted in Phase 2,
 * when its class became a shim), copied over plain arrays of `MinuteRange`s on
 * one shop day (flatten-spec §2.2 — the successor of the epoch-ms
 * `TimeInterval` sets), plus property tests against a brute-force minute-set
 * model.
 */

/**
 * Wall-clock minutes, so the fixtures read like a clock. A labelled cast,
 * test-only: the property domain deliberately includes empty and inverted
 * ranges no smart constructor would build, to prove every operation drops
 * them.
 */
const iv = (startMin: number, endMin: number): MinuteRange =>
  ({ startMinutes: startMin, endMinutes: endMin }) as MinuteRange;

/**
 * Arbitrary non-empty range of ONE shop day: a start in `[0, 1440)`, an end
 * in `(start, 1440]` — the only ranges the branded `MinuteRange` can hold
 * (a span past midnight is two ranges on two days, T7).
 */
const anyInterval = fc
  .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 240 }))
  .map(([start, length]) => iv(start, Math.min(start + length, 1440)));

const anyIntervals = fc.array(anyInterval, { maxLength: 12 });

/** Also empty and inverted ranges, which every operation must drop. */
const anyRawInterval = fc
  .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: -30, max: 240 }))
  .map(([start, length]) => iv(start, Math.min(start + length, 1440)));

const anyRawIntervals = fc.array(anyRawInterval, { maxLength: 12 });

/* ── The brute-force model: a set of covered minutes ───────────────────── */

const HORIZON = 1440 + 241;

function minutesOf(xs: readonly MinuteRange[]): boolean[] {
  const covered = new Array<boolean>(HORIZON).fill(false);
  for (const x of xs) {
    // `fill` reads a negative end from the back, so an inverted range must skip it.
    if (x.startMinutes < x.endMinutes)
      covered.fill(true, x.startMinutes, x.endMinutes);
  }
  return covered;
}

function combine(
  a: readonly boolean[],
  b: readonly boolean[],
  op: (x: boolean, y: boolean) => boolean,
): boolean[] {
  return a.map((x, i) => op(x, b.at(i) === true));
}

/** Canonical: sorted, non-empty, disjoint and not even touching. */
function expectCanonical(xs: readonly MinuteRange[]): void {
  xs.forEach((x, i) => {
    expect(x.startMinutes).toBeLessThan(x.endMinutes);
    if (i > 0)
      expect(x.startMinutes).toBeGreaterThan(
        (xs.at(i - 1) as MinuteRange).endMinutes,
      );
  });
}

describe('IntervalSetSystem.normalize', () => {
  it('sorts, merges overlapping runs and drops empties', () => {
    expect(
      IntervalSetSystem.normalize([
        iv(60, 90),
        iv(0, 30),
        iv(20, 40),
        iv(100, 100),
      ]),
    ).toEqual([iv(0, 40), iv(60, 90)]);
  });

  it('MERGES touching ranges — as minutes they are one run', () => {
    // Leaving these split would reject a 60-minute service that fits the
    // union because it fits neither half.
    expect(IntervalSetSystem.normalize([iv(0, 30), iv(30, 60)])).toEqual([
      iv(0, 60),
    ]);
  });

  it('drops inverted intervals and keeps a run that swallows a later one', () => {
    expect(
      IntervalSetSystem.normalize([iv(50, 40), iv(0, 100), iv(10, 20)]),
    ).toEqual([iv(0, 100)]);
  });

  it('is idempotent and always yields a disjoint, ascending list', () => {
    fc.assert(
      fc.property(anyIntervals, (intervals) => {
        const once = IntervalSetSystem.normalize(intervals);
        expect(IntervalSetSystem.normalize(once)).toEqual(once);
        once.slice(1).forEach((next, i) => {
          // Strictly after, and not merely touching (those merged).
          expect(next.startMinutes).toBeGreaterThan(
            (once.at(i) as MinuteRange).endMinutes,
          );
        });
      }),
    );
  });

  it('hands a normalized input straight back — no copy, no sort', () => {
    const set = IntervalSetSystem.normalize([iv(60, 90), iv(0, 30)]);
    expect(IntervalSetSystem.normalize(set)).toBe(set);
  });
});

describe('IntervalSetSystem.subtract — the operation availability is built from', () => {
  it('cuts a hole out of the middle', () => {
    expect(IntervalSetSystem.subtract([iv(0, 120)], [iv(30, 60)])).toEqual([
      iv(0, 30),
      iv(60, 120),
    ]);
  });

  it('trims the leading and trailing edges', () => {
    expect(IntervalSetSystem.subtract([iv(0, 120)], [iv(0, 30)])).toEqual([
      iv(30, 120),
    ]);
    expect(IntervalSetSystem.subtract([iv(0, 120)], [iv(90, 200)])).toEqual([
      iv(0, 90),
    ]);
  });

  it('removes a window entirely when fully covered', () => {
    expect(IntervalSetSystem.subtract([iv(30, 60)], [iv(0, 120)])).toEqual([]);
  });

  it('ignores cuts that merely TOUCH — half-open, so nothing is consumed', () => {
    // A 10:45 booking does not shorten a window ending at 10:45. This is the
    // rule that lets one barber take a party's next seat immediately.
    expect(IntervalSetSystem.subtract([iv(0, 45)], [iv(45, 90)])).toEqual([
      iv(0, 45),
    ]);
  });

  it('handles several cuts and unsorted input', () => {
    expect(
      IntervalSetSystem.subtract(
        [iv(0, 240)],
        [iv(120, 150), iv(30, 60), iv(30, 45)],
      ),
    ).toEqual([iv(0, 30), iv(60, 120), iv(150, 240)]);
  });

  it('lets one cut span several windows', () => {
    expect(
      IntervalSetSystem.subtract(
        [iv(0, 60), iv(90, 150), iv(200, 260)],
        [iv(30, 210)],
      ),
    ).toEqual([iv(0, 30), iv(210, 260)]);
  });

  it('never returns more minutes than it started with, and never overlaps a cut', () => {
    fc.assert(
      fc.property(anyIntervals, anyIntervals, (base, cut) => {
        const free = IntervalSetSystem.subtract(base, cut);
        expect(IntervalSetSystem.totalMinutes(free)).toBeLessThanOrEqual(
          IntervalSetSystem.totalMinutes(base),
        );
        for (const gap of free) {
          for (const taken of cut) {
            expect(MinuteRange.overlaps(gap, taken)).toBe(false);
          }
        }
      }),
    );
  });

  it('subtracting nothing is a normalize', () => {
    fc.assert(
      fc.property(anyIntervals, (base) => {
        expect(IntervalSetSystem.subtract(base, [])).toEqual(
          IntervalSetSystem.normalize(base),
        );
      }),
    );
  });
});

describe('IntervalSetSystem.intersect / union', () => {
  it('intersects overlapping runs', () => {
    expect(IntervalSetSystem.intersect([iv(0, 120)], [iv(60, 200)])).toEqual([
      iv(60, 120),
    ]);
  });

  it('yields nothing for disjoint or merely touching runs', () => {
    expect(IntervalSetSystem.intersect([iv(0, 30)], [iv(60, 90)])).toEqual([]);
    expect(IntervalSetSystem.intersect([iv(0, 30)], [iv(30, 60)])).toEqual([]);
  });

  it('intersects many-to-many', () => {
    expect(
      IntervalSetSystem.intersect([iv(0, 60), iv(120, 180)], [iv(30, 150)]),
    ).toEqual([iv(30, 60), iv(120, 150)]);
  });

  it('clips to a bound, dropping what falls entirely outside it (the deleted `clip`, OR-21)', () => {
    expect(
      IntervalSetSystem.intersect(
        [iv(0, 30), iv(50, 100), iv(200, 260), iv(300, 360)],
        [iv(20, 220)],
      ),
    ).toEqual([iv(20, 30), iv(50, 100), iv(200, 220)]);
  });

  it('intersection is commutative and bounded by both sides', () => {
    fc.assert(
      fc.property(anyIntervals, anyIntervals, (a, b) => {
        const left = IntervalSetSystem.intersect(a, b);
        expect(IntervalSetSystem.intersect(b, a)).toEqual(left);
        expect(IntervalSetSystem.totalMinutes(left)).toBeLessThanOrEqual(
          Math.min(
            IntervalSetSystem.totalMinutes(a),
            IntervalSetSystem.totalMinutes(b),
          ),
        );
      }),
    );
  });

  it('union covers at least as much as either side', () => {
    fc.assert(
      fc.property(anyIntervals, anyIntervals, (a, b) => {
        const total = IntervalSetSystem.totalMinutes(
          IntervalSetSystem.union(a, b),
        );
        expect(total).toBeGreaterThanOrEqual(IntervalSetSystem.totalMinutes(a));
        expect(total).toBeGreaterThanOrEqual(IntervalSetSystem.totalMinutes(b));
      }),
    );
  });

  it('union merges touching runs from the two sides into one', () => {
    expect(
      IntervalSetSystem.union([iv(0, 30), iv(90, 120)], [iv(30, 60)]),
    ).toEqual([iv(0, 60), iv(90, 120)]);
    expect(IntervalSetSystem.union([], [iv(30, 60)])).toEqual([iv(30, 60)]);
    expect(IntervalSetSystem.union([iv(30, 60)], [])).toEqual([iv(30, 60)]);
  });
});

describe('MinuteRange.pad (the busy-buffer cases)', () => {
  it('grows outward by the given minutes', () => {
    expect(MinuteRange.pad(iv(60, 90), count(10), count(15))).toEqual(
      iv(50, 105),
    );
  });

  it('padding the BUSY side is what produces a single gap, not a double one', () => {
    // A 10-minute turnaround around a 10:00–10:45 booking leaves free time
    // ending 09:50 and resuming 10:55 — one gap of 10 minutes on each side.
    // Padding the candidate as well would silently double it.
    const busy = MinuteRange.pad(iv(600, 645), count(10), count(10));
    expect(IntervalSetSystem.subtract([iv(540, 720)], [busy])).toEqual([
      iv(540, 590),
      iv(655, 720),
    ]);
  });
});

describe('IntervalSetSystem.totalMinutes', () => {
  it('never double-counts overlapping input', () => {
    expect(IntervalSetSystem.totalMinutes([iv(0, 60), iv(30, 90)])).toBe(90);
  });

  it('is zero for empty input', () => {
    expect(IntervalSetSystem.totalMinutes([])).toBe(0);
  });
});

describe('IntervalSetSystem equals a brute-force minute-set model', () => {
  it('normalize covers exactly the minutes of its input, canonically', () => {
    fc.assert(
      fc.property(anyRawIntervals, (xs) => {
        const out = IntervalSetSystem.normalize(xs);
        expectCanonical(out);
        expect(minutesOf(out)).toEqual(minutesOf(xs));
      }),
    );
  });

  it('subtract is set difference', () => {
    fc.assert(
      fc.property(anyRawIntervals, anyRawIntervals, (a, b) => {
        const out = IntervalSetSystem.subtract(a, b);
        expectCanonical(out);
        expect(minutesOf(out)).toEqual(
          combine(minutesOf(a), minutesOf(b), (x, y) => x && !y),
        );
      }),
    );
  });

  it('intersect is set intersection', () => {
    fc.assert(
      fc.property(anyRawIntervals, anyRawIntervals, (a, b) => {
        const out = IntervalSetSystem.intersect(a, b);
        expectCanonical(out);
        expect(minutesOf(out)).toEqual(
          combine(minutesOf(a), minutesOf(b), (x, y) => x && y),
        );
      }),
    );
  });

  it('union is set union', () => {
    fc.assert(
      fc.property(anyRawIntervals, anyRawIntervals, (a, b) => {
        const out = IntervalSetSystem.union(a, b);
        expectCanonical(out);
        expect(minutesOf(out)).toEqual(
          combine(minutesOf(a), minutesOf(b), (x, y) => x || y),
        );
      }),
    );
  });

  it('totalMinutes counts the covered minutes', () => {
    fc.assert(
      fc.property(anyRawIntervals, (xs) => {
        expect(IntervalSetSystem.totalMinutes(xs)).toBe(
          minutesOf(xs).filter(Boolean).length,
        );
      }),
    );
  });
});

describe('IntervalSetSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const base = deepFreeze([iv(300, 360), iv(0, 120), iv(100, 200)]);
    const cut = deepFreeze([iv(30, 60), iv(150, 330)]);
    const run = () => ({
      normalized: IntervalSetSystem.normalize(base),
      free: IntervalSetSystem.subtract(base, cut),
      both: IntervalSetSystem.intersect(base, cut),
      either: IntervalSetSystem.union(base, cut),
      clipped: IntervalSetSystem.intersect(base, [iv(50, 310)]),
      total: IntervalSetSystem.totalMinutes(base),
    });
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(base).toEqual([iv(300, 360), iv(0, 120), iv(100, 200)]);
    expect(cut).toEqual([iv(30, 60), iv(150, 330)]);
  });

  it('is pure under any input (property)', () => {
    fc.assert(
      fc.property(anyRawIntervals, anyRawIntervals, (a, b) => {
        const left = deepFreeze(a);
        const right = deepFreeze(b);
        expect(IntervalSetSystem.subtract(left, right)).toEqual(
          IntervalSetSystem.subtract(left, right),
        );
        expect(IntervalSetSystem.union(left, right)).toEqual(
          IntervalSetSystem.union(left, right),
        );
      }),
    );
  });
});

/*
 * Pass C, S-13 — the roster extents of `staff-dashboard.ts` (the visit
 * sheet's frame, the create sheet's, the block sheet's lane): `Math.min`
 * over the windows' starts and `Math.max` over their ends, read AS GIVEN;
 * none → null, which each caller answers with its own fallback (0–1440, or
 * the block sheet's shut 0–0).
 */
describe('IntervalSetSystem.hull — the outer edges', () => {
  it('is null for no range', () => {
    expect(IntervalSetSystem.hull([])).toBeNull();
  });

  it('is the one range itself', () => {
    expect(IntervalSetSystem.hull([iv(540, 1080)])).toEqual(iv(540, 1080));
  });

  it('spans disjoint windows, the gap between them included', () => {
    // 09:00–13:00 and 14:00–18:00: the frame opens at nine, closes at six.
    expect(IntervalSetSystem.hull([iv(840, 1080), iv(540, 780)])).toEqual(
      iv(540, 1080),
    );
  });

  it('takes the earliest start and the latest end from different ranges', () => {
    expect(
      IntervalSetSystem.hull([iv(600, 1200), iv(540, 700), iv(900, 1000)]),
    ).toEqual(iv(540, 1200));
  });

  it('reads every range as given — an empty one still stretches it', () => {
    expect(IntervalSetSystem.hull([iv(600, 700), iv(1300, 1300)])).toEqual(
      iv(600, 1300),
    );
  });

  it('equals Math.min over the starts and Math.max over the ends (property)', () => {
    fc.assert(
      fc.property(anyRawIntervals, (xs) => {
        const hull = IntervalSetSystem.hull(xs);
        if (xs.length === 0) {
          expect(hull).toBeNull();
          return;
        }
        expect(hull).toEqual(
          iv(
            Math.min(...xs.map((x) => x.startMinutes)),
            Math.max(...xs.map((x) => x.endMinutes)),
          ),
        );
      }),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const xs = deepFreeze([iv(840, 1080), iv(540, 780)]);
    const once = IntervalSetSystem.hull(xs);
    expect(IntervalSetSystem.hull(xs)).toEqual(once);
    expect(xs).toEqual([iv(840, 1080), iv(540, 780)]);
  });
});
