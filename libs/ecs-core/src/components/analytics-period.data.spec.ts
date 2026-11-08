import { describe, expect, it } from 'vitest';
import { AnalyticsErrorCode } from '@core/errors';
import { LocalDate, Weekday } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { AnalyticsPeriod, AnalyticsSpan } from './analytics-period.data';

/*
 * The analytics period (`docs/designs/staff-analytics-v2.md`, Terms): a
 * DAY, a WEEK or a MONTH; its comparison period; the reach. Today is
 * Wednesday 14 October 2026, so the reach starts on 1 October 2025.
 */

const TODAY = localDate('2026-10-14');
const P = AnalyticsPeriod;

describe('AnalyticsPeriod — a DAY', () => {
  it('is one shop day, any day', () => {
    const day = P.dayOf(TODAY);
    expect(day).toEqual({
      analyticsSpan: AnalyticsSpan.Day,
      fromLocalDate: TODAY,
      toLocalDate: TODAY,
    });
    expect(P.length(day)).toBe(1);
    expect(P.days(day)).toEqual([TODAY]);
    for (const raw of ['2026-10-14', '2026-10-11', '2026-02-28']) {
      expect(P.of(AnalyticsSpan.Day, localDate(raw))).toEqual({
        ok: true,
        value: P.dayOf(localDate(raw)),
      });
    }
    expect(P.holding(AnalyticsSpan.Day, TODAY)).toEqual(day);
  });

  it('is compared with the same weekday a week earlier', () => {
    const previous = P.previous(P.dayOf(TODAY));
    expect(previous).toEqual(P.dayOf(localDate('2026-10-07')));
    expect(LocalDate.weekday(previous.fromLocalDate)).toBe(Weekday.Wed);
    // Across a month's edge too.
    expect(P.previous(P.dayOf(localDate('2026-10-03'))).fromLocalDate).toBe(
      '2026-09-26',
    );
  });
});

describe('AnalyticsPeriod — a WEEK and a MONTH', () => {
  it('still refuses a first day that is not a Monday or a 1st', () => {
    expect(P.of(AnalyticsSpan.Week, localDate('2026-10-12')).ok).toBe(true);
    expect(P.of(AnalyticsSpan.Week, TODAY)).toEqual({
      ok: false,
      error: {
        errorCode: AnalyticsErrorCode.InvalidInput,
        field: 'fromLocalDate',
      },
    });
    expect(P.of(AnalyticsSpan.Month, localDate('2026-10-02')).ok).toBe(false);
  });

  it('is compared with the week or month just before', () => {
    expect(P.previous(P.weekOf(TODAY))).toEqual(
      P.weekOf(localDate('2026-10-05')),
    );
    expect(P.previous(P.monthOf(TODAY))).toEqual(
      P.monthOf(localDate('2026-09-01')),
    );
    // January's comparison is last December.
    expect(P.previous(P.monthOf(localDate('2026-01-01')))).toEqual(
      P.monthOf(localDate('2025-12-01')),
    );
  });
});

describe('AnalyticsPeriod — the reach', () => {
  it('isWithinRange — a period starts no earlier than the 1st of the month 12 months back, and no later than today', () => {
    expect(P.isWithinRange(P.monthOf(localDate('2025-10-01')), TODAY)).toBe(
      true,
    );
    expect(P.isWithinRange(P.monthOf(localDate('2025-09-01')), TODAY)).toBe(
      false,
    );
    expect(P.isWithinRange(P.monthOf(localDate('2026-11-01')), TODAY)).toBe(
      false,
    );
    expect(P.isWithinRange(P.dayOf(TODAY), TODAY)).toBe(true);
    expect(P.isWithinRange(P.dayOf(localDate('2026-10-15')), TODAY)).toBe(
      false,
    );
    expect(P.isWithinRange(P.dayOf(localDate('2025-10-01')), TODAY)).toBe(true);
    expect(P.isWithinRange(P.dayOf(localDate('2025-09-30')), TODAY)).toBe(
      false,
    );
  });

  it('isComparable — false when the comparison period would start before the reach', () => {
    // Months: October 2025 is the reach's first; its comparison is out.
    expect(P.isComparable(P.monthOf(localDate('2025-11-01')), TODAY)).toBe(
      true,
    );
    expect(P.isComparable(P.monthOf(localDate('2025-10-01')), TODAY)).toBe(
      false,
    );
    // Weeks: the week of Monday 6 October 2025 compares with 29 September.
    expect(P.isComparable(P.weekOf(localDate('2025-10-13')), TODAY)).toBe(true);
    expect(P.isComparable(P.weekOf(localDate('2025-10-06')), TODAY)).toBe(
      false,
    );
    // Days: a week back must still be in reach.
    expect(P.isComparable(P.dayOf(localDate('2025-10-08')), TODAY)).toBe(true);
    expect(P.isComparable(P.dayOf(localDate('2025-10-07')), TODAY)).toBe(false);
    expect(P.isComparable(P.dayOf(TODAY), TODAY)).toBe(true);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const period = deepFreeze(P.dayOf(TODAY));
    expect(P.previous(period)).toEqual(P.previous(period));
    expect(P.isComparable(period, TODAY)).toBe(P.isComparable(period, TODAY));
    expect(period).toEqual(P.dayOf(TODAY));
  });
});
