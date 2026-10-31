import { describe, expect, it } from 'vitest';
import { StreakInterval, StreakIntervalRule } from './streak-interval.data';
import { StreakIntervalSource } from './streak-interval-source.data';

// The cases of `streak-interval.spec.ts`, on the flat slice.

const PERSONAL = {
  streakInterval: StreakInterval.Personal,
  intervalTolerancePct: 50,
  intervalMinDays: 21,
  intervalMaxDays: 70,
  intervalFallbackDays: 42,
} as const satisfies StreakIntervalRule;

const fixed = (intervalDays: number): StreakIntervalRule => ({
  streakInterval: StreakInterval.Fixed,
  intervalDays,
});

function interval(raw: StreakIntervalRule): StreakIntervalRule {
  const result = StreakIntervalRule.parse(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** The fault's code without its dictionary prefix, lower-cased: `interval_out_of_range`. */
const shortCode = (errorCode: string): string =>
  errorCode.replace('ENGAGEMENT_STREAK_DEFINITION_', '').toLowerCase();

/** Each fault as `code field`, in the order they were found. */
function faults(raw: StreakIntervalRule): string[] {
  const result = StreakIntervalRule.parse(raw);
  return result.ok
    ? []
    : result.error.map((e) => `${shortCode(e.errorCode)} ${e.field}`);
}

describe('StreakIntervalRule.parse', () => {
  it('publishes its ranges: two weeks to half a year, a tolerance in whole percent', () => {
    expect(StreakIntervalRule.LIMITS).toEqual({
      intervalDays: { min: 14, max: 182 },
      intervalTolerancePct: { min: 0, max: 100 },
    });
    expect(Object.values(StreakInterval)).toEqual(['FIXED', 'PERSONAL']);
    expect(Object.values(StreakIntervalSource)).toEqual([
      'FIXED',
      'PERSONAL',
      'FALLBACK',
    ]);
  });

  describe('fixed', () => {
    it.each([14, 42, 182])('takes %s days', (days) => {
      expect(faults(fixed(days))).toEqual([]);
    });

    it.each([13, 183, 0, -42, 42.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses %s days',
      (days) => {
        expect(faults(fixed(days))).toEqual([
          'interval_out_of_range intervalDays',
        ]);
      },
    );

    it('names the range and what was handed in', () => {
      const result = StreakIntervalRule.parse(fixed(7));
      expect(result.ok ? null : result.error[0]).toEqual({
        errorCode: 'ENGAGEMENT_STREAK_DEFINITION_INTERVAL_OUT_OF_RANGE',
        field: 'intervalDays',
        value: 7,
        min: 14,
        max: 182,
      });
    });

    it('hands back a fresh slice', () => {
      const raw = StreakIntervalRule.fixed(42);
      const parsed = interval(raw);
      expect(parsed).toEqual({ streakInterval: 'FIXED', intervalDays: 42 });
      expect(parsed).not.toBe(raw);
    });
  });

  describe('personal', () => {
    it('takes the recommended clamp', () => {
      expect(faults(PERSONAL)).toEqual([]);
      expect(interval(PERSONAL)).toEqual(
        StreakIntervalRule.personal(50, 21, 70, 42),
      );
    });

    it.each([0, 5, 100])(
      'takes a tolerance of %s %',
      (intervalTolerancePct) => {
        expect(faults({ ...PERSONAL, intervalTolerancePct })).toEqual([]);
      },
    );

    it.each([-1, 101, 12.5, Number.NaN])(
      'refuses a tolerance of %s %',
      (intervalTolerancePct) => {
        expect(faults({ ...PERSONAL, intervalTolerancePct })).toEqual([
          'tolerance_out_of_range intervalTolerancePct',
        ]);
      },
    );

    it('takes a clamp that spans the whole range, and one that is a single day', () => {
      expect(
        faults({
          ...PERSONAL,
          intervalMinDays: 14,
          intervalMaxDays: 182,
          intervalFallbackDays: 14,
        }),
      ).toEqual([]);
      expect(
        faults({
          ...PERSONAL,
          intervalMinDays: 42,
          intervalMaxDays: 42,
          intervalFallbackDays: 42,
        }),
      ).toEqual([]);
    });

    it.each([
      ['intervalMinDays', 13],
      ['intervalMinDays', 21.5],
      ['intervalMaxDays', 183],
      ['intervalMaxDays', 69.9],
      ['intervalFallbackDays', 13],
      ['intervalFallbackDays', 183],
      ['intervalFallbackDays', 42.5],
    ] as const)('refuses %s = %s', (field, value) => {
      expect(faults({ ...PERSONAL, [field]: value })).toEqual([
        `interval_out_of_range ${field}`,
      ]);
    });

    it('refuses a floor above the ceiling', () => {
      const result = StreakIntervalRule.parse({
        ...PERSONAL,
        intervalMinDays: 71,
        intervalMaxDays: 70,
        intervalFallbackDays: 70,
      });
      expect(result.ok ? [] : result.error).toEqual([
        {
          errorCode: 'ENGAGEMENT_STREAK_DEFINITION_CLAMP_INVERTED',
          field: 'intervalMinDays',
          value: 71,
          minDays: 71,
          maxDays: 70,
        },
      ]);
    });

    it.each([20, 71])(
      'refuses a newcomer’s %s days outside the clamp',
      (intervalFallbackDays) => {
        const result = StreakIntervalRule.parse({
          ...PERSONAL,
          intervalFallbackDays,
        });
        expect(result.ok ? [] : result.error).toEqual([
          {
            errorCode: 'ENGAGEMENT_STREAK_DEFINITION_FALLBACK_OUTSIDE_CLAMP',
            field: 'intervalFallbackDays',
            value: intervalFallbackDays,
            minDays: 21,
            maxDays: 70,
          },
        ]);
      },
    );

    it.each([21, 70])(
      'takes a newcomer’s %s days on the clamp’s edge',
      (intervalFallbackDays) => {
        expect(faults({ ...PERSONAL, intervalFallbackDays })).toEqual([]);
      },
    );

    it('reports every fault at once, and judges the clamp only over sound bounds', () => {
      expect(
        faults({
          streakInterval: StreakInterval.Personal,
          intervalTolerancePct: 120,
          intervalMinDays: 3,
          intervalMaxDays: 200,
          intervalFallbackDays: 42,
        }),
      ).toEqual([
        'tolerance_out_of_range intervalTolerancePct',
        'interval_out_of_range intervalMinDays',
        'interval_out_of_range intervalMaxDays',
      ]);
    });
  });

  it('refuses an interval it does not know', () => {
    const result = StreakIntervalRule.parse({
      streakInterval: 'CALENDAR',
      unit: 'month',
      every: 1,
    } as unknown as StreakIntervalRule);
    expect(result.ok ? [] : result.error).toEqual([
      {
        errorCode: 'ENGAGEMENT_STREAK_DEFINITION_UNKNOWN_OPTION',
        field: 'streakInterval',
        value: 'CALENDAR',
        options: 'FIXED, PERSONAL',
      },
    ]);
  });
});

describe('StreakIntervalRule.daysFor', () => {
  it('gives everyone the fixed interval, whatever their habit', () => {
    const rule = StreakIntervalRule.fixed(42);
    expect(StreakIntervalRule.daysFor(rule, null)).toEqual({
      days: 42,
      source: 'FIXED',
    });
    expect(StreakIntervalRule.daysFor(rule, 26)).toEqual({
      days: 42,
      source: 'FIXED',
    });
  });

  it.each([
    // rhythm-admin §4.2, tolerance 50 %, clamp 21–70
    { who: 'Георги, every 26 days', habit: 26, days: 39 },
    { who: 'Мартин, every 38 days', habit: 38, days: 57 },
    { who: 'a habit of 27 days, rounded to the day', habit: 27, days: 41 },
    { who: 'a mean of 30.4 days', habit: 30.4, days: 46 },
  ])('$who is due in $days days', ({ habit, days }) => {
    expect(StreakIntervalRule.daysFor(PERSONAL, habit)).toEqual({
      days,
      source: 'PERSONAL',
    });
  });

  it('holds a short habit at the floor and a long one at the ceiling', () => {
    expect(StreakIntervalRule.daysFor(PERSONAL, 10)).toEqual({
      days: 21,
      source: 'PERSONAL',
    });
    expect(StreakIntervalRule.daysFor(PERSONAL, 14)).toEqual({
      days: 21,
      source: 'PERSONAL',
    });
    expect(StreakIntervalRule.daysFor(PERSONAL, 60)).toEqual({
      days: 70,
      source: 'PERSONAL',
    });
  });

  it('adds nothing at a tolerance of 0 and doubles at 100', () => {
    expect(
      StreakIntervalRule.daysFor({ ...PERSONAL, intervalTolerancePct: 0 }, 30)
        .days,
    ).toBe(30);
    expect(
      StreakIntervalRule.daysFor({ ...PERSONAL, intervalTolerancePct: 100 }, 30)
        .days,
    ).toBe(60);
  });

  it.each([null, 0, -12, Number.NaN, Number.POSITIVE_INFINITY])(
    'gives the newcomer’s interval for a habit of %s',
    (habit) => {
      expect(StreakIntervalRule.daysFor(PERSONAL, habit)).toEqual({
        days: 42,
        source: 'FALLBACK',
      });
    },
  );
});

describe('StreakIntervalRule, as a value', () => {
  it('knows the shortest and the longest period it can open', () => {
    const rule = StreakIntervalRule.fixed(35);
    expect([
      StreakIntervalRule.shortestDays(rule),
      StreakIntervalRule.longestDays(rule),
    ]).toEqual([35, 35]);
    expect([
      StreakIntervalRule.shortestDays(PERSONAL),
      StreakIntervalRule.longestDays(PERSONAL),
    ]).toEqual([21, 70]);
  });

  it('equals by its figures', () => {
    const eq = StreakIntervalRule.equals;
    expect(eq(StreakIntervalRule.fixed(42), StreakIntervalRule.fixed(42))).toBe(
      true,
    );
    expect(eq(StreakIntervalRule.fixed(42), StreakIntervalRule.fixed(35))).toBe(
      false,
    );
    expect(eq(PERSONAL, { ...PERSONAL })).toBe(true);
    expect(eq(PERSONAL, { ...PERSONAL, intervalTolerancePct: 25 })).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL, intervalMinDays: 14 })).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL, intervalMaxDays: 80 })).toBe(false);
    expect(eq(PERSONAL, { ...PERSONAL, intervalFallbackDays: 35 })).toBe(false);
    expect(eq(StreakIntervalRule.fixed(42), PERSONAL)).toBe(false);
    expect(eq(PERSONAL, StreakIntervalRule.fixed(42))).toBe(false);
  });

  it('copies just the interval fields of a whole rule, as a slice of their own', () => {
    const rule = { ...PERSONAL, graceDays: 7, enabled: true };
    expect(StreakIntervalRule.sliceOf(rule)).toEqual(PERSONAL);
    expect(StreakIntervalRule.sliceOf(fixed(42))).toEqual(fixed(42));
  });
});

describe('StreakIntervalRule.daysFor — the admin’s tolerance example on one habit', () => {
  const HABIT = 28;
  const personal = StreakIntervalRule.personal(50, 21, 70, 42);

  it('stretches the habit by the tolerance', () => {
    expect(StreakIntervalRule.daysFor(personal, HABIT)).toEqual({
      days: 42,
      source: StreakIntervalSource.Personal,
    });
  });

  it('holds the example inside the clamp', () => {
    expect(
      StreakIntervalRule.daysFor({ ...personal, intervalMaxDays: 35 }, HABIT)
        .days,
    ).toBe(35);
    expect(
      StreakIntervalRule.daysFor(
        StreakIntervalRule.personal(0, 35, 70, 42),
        HABIT,
      ).days,
    ).toBe(35);
  });

  it('equals the words’ old round(28·(1 + p/100)) for every whole percent (§7 R-13)', () => {
    const clamps: readonly (readonly [number, number])[] = [
      [14, 182],
      [21, 70],
      [30, 35],
      [42, 56],
    ];
    for (const [min, max] of clamps) {
      for (let pct = 0; pct <= 100; pct++) {
        const old = Math.min(
          max,
          Math.max(min, Math.round(HABIT * (1 + pct / 100))),
        );
        expect(
          StreakIntervalRule.daysFor(
            StreakIntervalRule.personal(pct, min, max, min),
            HABIT,
          ).days,
        ).toBe(old);
      }
    }
  });
});
