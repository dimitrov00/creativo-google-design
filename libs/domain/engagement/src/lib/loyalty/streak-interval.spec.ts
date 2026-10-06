import { describe, expect, it } from 'vitest';
import {
  STREAK_INTERVAL_LIMITS,
  StreakInterval,
  StreakIntervalProps,
} from './streak-interval';

const PERSONAL = {
  kind: 'personal',
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
  fallbackDays: 42,
} as const satisfies StreakIntervalProps;

function interval(props: StreakIntervalProps): StreakInterval {
  const result = StreakInterval.create(props);
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Each fault as `code field`, in the order they were found. */
function faults(props: StreakIntervalProps): string[] {
  const result = StreakInterval.create(props);
  return result.isFailure()
    ? result.error.map((e) => `${e.code.split('.').pop()} ${e.field}`)
    : [];
}

describe('StreakInterval.create', () => {
  it('publishes its ranges: two weeks to half a year, a tolerance in whole percent', () => {
    expect(STREAK_INTERVAL_LIMITS).toEqual({
      days: { min: 14, max: 182 },
      tolerancePct: { min: 0, max: 100 },
    });
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
      const result = StreakInterval.create({ kind: 'fixed', days: 7 });
      expect(result.isFailure() && result.error[0]).toMatchObject({
        code: 'engagement.streak_definition.interval_out_of_range',
        field: 'interval.days',
        value: 7,
        min: 14,
        max: 182,
      });
    });
  });

  describe('personal', () => {
    it('takes the recommended clamp', () => {
      expect(faults(PERSONAL)).toEqual([]);
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
      const result = StreakInterval.create({
        ...PERSONAL,
        minDays: 71,
        maxDays: 70,
        fallbackDays: 70,
      });
      expect(result.isFailure() && result.error).toHaveLength(1);
      expect(result.isFailure() && result.error[0]).toMatchObject({
        code: 'engagement.streak_definition.clamp_inverted',
        field: 'interval.minDays',
        value: 71,
        minDays: 71,
        maxDays: 70,
      });
    });

    it.each([20, 71])(
      'refuses a newcomer’s %s days outside the clamp',
      (fallbackDays) => {
        const result = StreakInterval.create({ ...PERSONAL, fallbackDays });
        expect(result.isFailure() && result.error).toHaveLength(1);
        expect(result.isFailure() && result.error[0]).toMatchObject({
          code: 'engagement.streak_definition.fallback_outside_clamp',
          field: 'interval.fallbackDays',
          value: fallbackDays,
          minDays: 21,
          maxDays: 70,
        });
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
    const result = StreakInterval.create({
      kind: 'calendar',
      unit: 'month',
      every: 1,
    } as unknown as StreakIntervalProps);
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_definition.unknown_option',
      field: 'interval.kind',
      value: 'calendar',
      options: ['fixed', 'personal'],
    });
  });
});

describe('StreakInterval.daysFor', () => {
  it('gives everyone the fixed interval, whatever their habit', () => {
    const fixed = interval({ kind: 'fixed', days: 42 });
    expect(fixed.daysFor(null)).toEqual({ days: 42, source: 'fixed' });
    expect(fixed.daysFor(26)).toEqual({ days: 42, source: 'fixed' });
  });

  it.each([
    // rhythm-admin §4.2, tolerance 50 %, clamp 21–70
    { who: 'Георги, every 26 days', habit: 26, days: 39 },
    { who: 'Мартин, every 38 days', habit: 38, days: 57 },
    { who: 'a habit of 27 days, rounded to the day', habit: 27, days: 41 },
    { who: 'a mean of 30.4 days', habit: 30.4, days: 46 },
  ])('$who is due in $days days', ({ habit, days }) => {
    expect(interval(PERSONAL).daysFor(habit)).toEqual({
      days,
      source: 'personal',
    });
  });

  it('holds a short habit at the floor and a long one at the ceiling', () => {
    const personal = interval(PERSONAL);
    expect(personal.daysFor(10)).toEqual({ days: 21, source: 'personal' });
    expect(personal.daysFor(14)).toEqual({ days: 21, source: 'personal' });
    expect(personal.daysFor(60)).toEqual({ days: 70, source: 'personal' });
  });

  it('adds nothing at a tolerance of 0 and doubles at 100', () => {
    expect(interval({ ...PERSONAL, tolerancePct: 0 }).daysFor(30).days).toBe(
      30,
    );
    expect(interval({ ...PERSONAL, tolerancePct: 100 }).daysFor(30).days).toBe(
      60,
    );
  });

  it.each([null, 0, -12, Number.NaN, Number.POSITIVE_INFINITY])(
    'gives the newcomer’s interval for a habit of %s',
    (habit) => {
      expect(interval(PERSONAL).daysFor(habit)).toEqual({
        days: 42,
        source: 'fallback',
      });
    },
  );
});

describe('StreakInterval, as a value', () => {
  it('knows the shortest and the longest period it can open', () => {
    const fixed = interval({ kind: 'fixed', days: 35 });
    expect([fixed.kind, fixed.shortestDays, fixed.longestDays]).toEqual([
      'fixed',
      35,
      35,
    ]);
    const personal = interval(PERSONAL);
    expect([
      personal.kind,
      personal.shortestDays,
      personal.longestDays,
    ]).toEqual(['personal', 21, 70]);
  });

  it('equals by its figures', () => {
    expect(
      interval({ kind: 'fixed', days: 42 }).equals(
        interval({ kind: 'fixed', days: 42 }),
      ),
    ).toBe(true);
    expect(
      interval({ kind: 'fixed', days: 42 }).equals(
        interval({ kind: 'fixed', days: 35 }),
      ),
    ).toBe(false);
    expect(interval(PERSONAL).equals(interval({ ...PERSONAL }))).toBe(true);
    expect(
      interval(PERSONAL).equals(interval({ ...PERSONAL, tolerancePct: 25 })),
    ).toBe(false);
    expect(
      interval(PERSONAL).equals(interval({ ...PERSONAL, fallbackDays: 35 })),
    ).toBe(false);
    expect(
      interval({ kind: 'fixed', days: 42 }).equals(interval(PERSONAL)),
    ).toBe(false);
    expect(
      interval(PERSONAL).equals(interval({ kind: 'fixed', days: 42 })),
    ).toBe(false);
  });

  it('hands out a copy of its figures, never its own', () => {
    const personal = interval(PERSONAL);
    const props = personal.toProps();
    expect(props).toEqual(PERSONAL);
    (props as { minDays: number }).minDays = 14;
    expect(personal.toProps()).toEqual(PERSONAL);
    expect(personal.shortestDays).toBe(21);
  });

  it('keeps nothing of what it was made from', () => {
    const props: StreakIntervalProps = { ...PERSONAL };
    const personal = interval(props);
    (props as { maxDays: number }).maxDays = 182;
    expect(personal.longestDays).toBe(70);
  });
});
