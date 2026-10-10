import { describe, expect, it } from 'vitest';
import {
  StreakInterval,
  StreakIntervalKind,
  StreakIntervalSource,
} from './streak-interval.data';

// The cases of `streak-interval.spec.ts`, on the plain struct.

const PERSONAL = {
  kind: 'personal',
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
  fallbackDays: 42,
} as const satisfies StreakInterval;

function interval(raw: StreakInterval): StreakInterval {
  const result = StreakInterval.parse(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Each fault as `code field`, in the order they were found. */
function faults(raw: StreakInterval): string[] {
  const result = StreakInterval.parse(raw);
  return result.ok
    ? []
    : result.error.map((e) => `${e.code.split('.').pop()} ${e.field}`);
}

describe('StreakInterval.parse', () => {
  it('publishes its ranges: two weeks to half a year, a tolerance in whole percent', () => {
    expect(StreakInterval.LIMITS).toEqual({
      days: { min: 14, max: 182 },
      tolerancePct: { min: 0, max: 100 },
    });
    expect(Object.values(StreakIntervalKind)).toEqual(['fixed', 'personal']);
    expect(Object.values(StreakIntervalSource)).toEqual([
      'fixed',
      'personal',
      'fallback',
    ]);
  });

  describe('fixed', () => {
    it.each([14, 42, 182])('takes %s days', (days) => {
      expect(faults({ kind: 'fixed', days })).toEqual([]);
    });

    it.each([13, 183, 0, -42, 42.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses %s days',
      (days) => {
        expect(faults({ kind: 'fixed', days })).toEqual([
          'interval_out_of_range interval.days',
        ]);
      },
    );

    it('names the range and what was handed in', () => {
      const result = StreakInterval.parse({ kind: 'fixed', days: 7 });
      expect(result.ok ? null : result.error[0]).toEqual({
        code: 'engagement.streak_definition.interval_out_of_range',
        field: 'interval.days',
        value: 7,
        min: 14,
        max: 182,
      });
    });

    it('hands back a fresh struct', () => {
      const raw = StreakInterval.fixed(42);
      const parsed = interval(raw);
      expect(parsed).toEqual({ kind: 'fixed', days: 42 });
      expect(parsed).not.toBe(raw);
    });
  });

  describe('personal', () => {
    it('takes the recommended clamp', () => {
      expect(faults(PERSONAL)).toEqual([]);
      expect(interval(PERSONAL)).toEqual(
        StreakInterval.personal(50, 21, 70, 42),
      );
    });

    it.each([0, 5, 100])('takes a tolerance of %s %', (tolerancePct) => {
      expect(faults({ ...PERSONAL, tolerancePct })).toEqual([]);
    });

    it.each([-1, 101, 12.5, Number.NaN])(
      'refuses a tolerance of %s %',
      (tolerancePct) => {
        expect(faults({ ...PERSONAL, tolerancePct })).toEqual([
          'tolerance_out_of_range interval.tolerancePct',
        ]);
      },
    );

    it('takes a clamp that spans the whole range, and one that is a single day', () => {
      expect(
        faults({ ...PERSONAL, minDays: 14, maxDays: 182, fallbackDays: 14 }),
      ).toEqual([]);
      expect(
        faults({ ...PERSONAL, minDays: 42, maxDays: 42, fallbackDays: 42 }),
      ).toEqual([]);
    });

    it.each([
      ['minDays', 13],
      ['minDays', 21.5],
      ['maxDays', 183],
      ['maxDays', 69.9],
      ['fallbackDays', 13],
      ['fallbackDays', 183],
      ['fallbackDays', 42.5],
    ] as const)('refuses %s = %s', (field, value) => {
      expect(faults({ ...PERSONAL, [field]: value })).toEqual([
        `interval_out_of_range interval.${field}`,
      ]);
    });

    it('refuses a floor above the ceiling', () => {
      const result = StreakInterval.parse({
        ...PERSONAL,
        minDays: 71,
        maxDays: 70,
        fallbackDays: 70,
      });
      expect(result.ok ? [] : result.error).toEqual([
        {
          code: 'engagement.streak_definition.clamp_inverted',
          field: 'interval.minDays',
          value: 71,
          minDays: 71,
          maxDays: 70,
        },
      ]);
    });

    it.each([20, 71])(
      'refuses a newcomer’s %s days outside the clamp',
      (fallbackDays) => {
        const result = StreakInterval.parse({ ...PERSONAL, fallbackDays });
        expect(result.ok ? [] : result.error).toEqual([
          {
            code: 'engagement.streak_definition.fallback_outside_clamp',
            field: 'interval.fallbackDays',
            value: fallbackDays,
            minDays: 21,
            maxDays: 70,
          },
        ]);
      },
    );

    it.each([21, 70])(
      'takes a newcomer’s %s days on the clamp’s edge',
      (fallbackDays) => {
        expect(faults({ ...PERSONAL, fallbackDays })).toEqual([]);
      },
    );

    it('reports every fault at once, and judges the clamp only over sound bounds', () => {
      expect(
        faults({
          kind: 'personal',
          tolerancePct: 120,
          minDays: 3,
          maxDays: 200,
          fallbackDays: 42,
        }),
      ).toEqual([
        'tolerance_out_of_range interval.tolerancePct',
        'interval_out_of_range interval.minDays',
        'interval_out_of_range interval.maxDays',
      ]);
    });
  });

  it('refuses a kind it does not know', () => {
    const result = StreakInterval.parse({
      kind: 'calendar',
      unit: 'month',
      every: 1,
    } as unknown as StreakInterval);
    expect(result.ok ? [] : result.error).toEqual([
      {
        code: 'engagement.streak_definition.unknown_option',
        field: 'interval.kind',
        value: 'calendar',
        options: 'fixed, personal',
      },
    ]);
  });
});

describe('StreakInterval.daysFor', () => {
  it('gives everyone the fixed interval, whatever their habit', () => {
    const fixed = StreakInterval.fixed(42);
    expect(StreakInterval.daysFor(fixed, null)).toEqual({
      days: 42,
      source: 'fixed',
    });
    expect(StreakInterval.daysFor(fixed, 26)).toEqual({
      days: 42,
      source: 'fixed',
    });
  });

  it.each([
    // rhythm-admin §4.2, tolerance 50 %, clamp 21–70
    { who: 'Георги, every 26 days', habit: 26, days: 39 },
    { who: 'Мартин, every 38 days', habit: 38, days: 57 },
    { who: 'a habit of 27 days, rounded to the day', habit: 27, days: 41 },
    { who: 'a mean of 30.4 days', habit: 30.4, days: 46 },
  ])('$who is due in $days days', ({ habit, days }) => {
    expect(StreakInterval.daysFor(PERSONAL, habit)).toEqual({
      days,
      source: 'personal',
    });
  });

  it('holds a short habit at the floor and a long one at the ceiling', () => {
    expect(StreakInterval.daysFor(PERSONAL, 10)).toEqual({
      days: 21,
      source: 'personal',
    });
    expect(StreakInterval.daysFor(PERSONAL, 14)).toEqual({
      days: 21,
      source: 'personal',
    });
    expect(StreakInterval.daysFor(PERSONAL, 60)).toEqual({
      days: 70,
      source: 'personal',
    });
  });

  it('adds nothing at a tolerance of 0 and doubles at 100', () => {
    expect(
      StreakInterval.daysFor({ ...PERSONAL, tolerancePct: 0 }, 30).days,
    ).toBe(30);
    expect(
      StreakInterval.daysFor({ ...PERSONAL, tolerancePct: 100 }, 30).days,
    ).toBe(60);
  });

  it.each([null, 0, -12, Number.NaN, Number.POSITIVE_INFINITY])(
    'gives the newcomer’s interval for a habit of %s',
    (habit) => {
      expect(StreakInterval.daysFor(PERSONAL, habit)).toEqual({
        days: 42,
        source: 'fallback',
      });
    },
  );
});

describe('StreakInterval, as a value', () => {
  it('knows the shortest and the longest period it can open', () => {
    const fixed = StreakInterval.fixed(35);
    expect([
      StreakInterval.shortestDays(fixed),
      StreakInterval.longestDays(fixed),
    ]).toEqual([35, 35]);
    expect([
      StreakInterval.shortestDays(PERSONAL),
      StreakInterval.longestDays(PERSONAL),
    ]).toEqual([21, 70]);
  });

  it('equals by its figures', () => {
    const eq = StreakInterval.equals;
    expect(eq(StreakInterval.fixed(42), StreakInterval.fixed(42))).toBe(true);
    expect(eq(StreakInterval.fixed(42), StreakInterval.fixed(35))).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL })).toBe(true);
    expect(eq(PERSONAL, { ...PERSONAL, tolerancePct: 25 })).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL, minDays: 14 })).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL, maxDays: 80 })).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL, fallbackDays: 35 })).toBe(false);
    expect(eq(StreakInterval.fixed(42), PERSONAL)).toBe(false);
    expect(eq(PERSONAL, StreakInterval.fixed(42))).toBe(false);
  });
});
