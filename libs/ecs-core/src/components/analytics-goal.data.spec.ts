import { describe, expect, it } from 'vitest';
import { AnalyticsErrorCode } from '@core/errors';
import {
  BarberId,
  Currency,
  MonthKey,
  type PriceCents,
  UserId,
} from '@core/primitives';
import { FIXTURE_NOW_UTC_MS, deepFreeze, unwrapOk } from '@core/testing';
import { AnalyticsGoal } from './analytics-goal.data';

const ivan = BarberId.of('ivan');
const cents = (raw: number): PriceCents => raw as PriceCents;

/** Ivan's November 2026: 1 800–2 200 €. */
function goal(overrides: Partial<AnalyticsGoal> = {}): AnalyticsGoal {
  return {
    barberId: ivan,
    goalMonth: MonthKey.of('2026-11'),
    goalLowCents: cents(180_000),
    goalHighCents: cents(220_000),
    currency: Currency.EUR,
    goalSetByUserId: UserId.of('u-ivan'),
    goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
    ...overrides,
  };
}

describe('AnalyticsGoal.rangeOrClearOf — a goal call’s intent', () => {
  it('reads no range as the goal removed, refuses a lone bound, and asks rangeOf of two', () => {
    expect(unwrapOk(AnalyticsGoal.rangeOrClearOf(null, null))).toBeNull();
    expect(AnalyticsGoal.rangeOrClearOf(null, 220_000)).toEqual({
      ok: false,
      error: {
        errorCode: 'ANALYTICS_GOAL_INVALID_RANGE',
        field: 'goalLowCents',
      },
    });
    expect(AnalyticsGoal.rangeOrClearOf(180_000, null)).toEqual({
      ok: false,
      error: {
        errorCode: 'ANALYTICS_GOAL_INVALID_RANGE',
        field: 'goalHighCents',
      },
    });
    expect(unwrapOk(AnalyticsGoal.rangeOrClearOf(180_000, 220_000))).toEqual({
      goalLowCents: 180_000,
      goalHighCents: 220_000,
    });
  });
});

describe('AnalyticsGoal.rangeOf — the ONE range rule (PR 6)', () => {
  it('admits a positive low bound and a high bound at least as large — the same figure twice included', () => {
    expect(unwrapOk(AnalyticsGoal.rangeOf(180_000, 220_000))).toEqual({
      goalLowCents: 180_000,
      goalHighCents: 220_000,
    });
    expect(unwrapOk(AnalyticsGoal.rangeOf(1, 1))).toEqual({
      goalLowCents: 1,
      goalHighCents: 1,
    });
  });

  it('refuses a low bound that is no positive whole number of cents, naming goalLowCents', () => {
    for (const low of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const refused = AnalyticsGoal.rangeOf(low, 220_000);
      expect(!refused.ok && refused.error).toEqual({
        errorCode: AnalyticsErrorCode.GoalInvalidRange,
        field: 'goalLowCents',
      });
    }
  });

  it('refuses a high bound under the low one or no whole number of cents, naming goalHighCents', () => {
    for (const high of [179_999, 0, -5, 220_000.5, Number.NaN]) {
      const refused = AnalyticsGoal.rangeOf(180_000, high);
      expect(!refused.ok && refused.error).toEqual({
        errorCode: AnalyticsErrorCode.GoalInvalidRange,
        field: 'goalHighCents',
      });
    }
  });

  it('is pure: same input → same output', () => {
    expect(AnalyticsGoal.rangeOf(100, 200)).toEqual(
      AnalyticsGoal.rangeOf(100, 200),
    );
  });
});

describe('AnalyticsGoal.is — the stored body’s door', () => {
  it('admits a barber’s goal and the shop’s (barberId null) as stored', () => {
    expect(AnalyticsGoal.is(deepFreeze(goal()))).toBe(true);
    expect(AnalyticsGoal.is(goal({ barberId: null }))).toBe(true);
  });

  it('refuses a body with a field missing, of the wrong shape, or whose range is no range', () => {
    const good = goal() as Record<string, unknown>;
    for (const broken of [
      null,
      'goal',
      {},
      { ...good, barberId: 7 },
      { ...good, barberId: undefined },
      { ...good, goalMonth: '2026-11-01' },
      { ...good, goalMonth: '2026-13' },
      { ...good, goalLowCents: 0 },
      { ...good, goalLowCents: -1 },
      { ...good, goalLowCents: '180000' },
      { ...good, goalHighCents: 179_999 },
      { ...good, goalHighCents: 1.5 },
      { ...good, currency: 'EURO' },
      { ...good, goalSetByUserId: '' },
      { ...good, goalSetAtUtcMs: 'now' },
    ]) {
      expect(AnalyticsGoal.is(broken)).toBe(false);
    }
  });
});
