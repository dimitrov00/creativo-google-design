import { describe, expect, it } from 'vitest';
import { AnalyticsErrorCode } from '@core/errors';
import { LocalDate, Weekday } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { AnalyticsPeriod, AnalyticsSpan } from './analytics-period.data';

/*
 * The analytics period (`docs/designs/staff-analytics-v2.md`, Terms): a
 * DAY, a WEEK, a MONTH, a YEAR or a CUSTOM range; its comparison period;
 * the reach. Today is Wednesday 14 October 2026, so the reach starts on
 * 1 October 2025.
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
      expect(P.of(AnalyticsSpan.Day, localDate(raw), null)).toEqual({
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
    expect(P.of(AnalyticsSpan.Week, localDate('2026-10-12'), null).ok).toBe(
      true,
    );
    expect(P.of(AnalyticsSpan.Week, TODAY, null)).toEqual({
      ok: false,
      error: {
        errorCode: AnalyticsErrorCode.InvalidInput,
        field: 'fromLocalDate',
      },
    });
    expect(P.of(AnalyticsSpan.Month, localDate('2026-10-02'), null).ok).toBe(
      false,
    );
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

  it('refuses a `to` on a fixed span — `toLocalDate` is null unless CUSTOM', () => {
    for (const span of [
      AnalyticsSpan.Day,
      AnalyticsSpan.Week,
      AnalyticsSpan.Month,
      AnalyticsSpan.Year,
    ]) {
      expect(
        P.of(span, localDate('2026-01-01'), localDate('2026-01-31')),
      ).toEqual({
        ok: false,
        error: {
          errorCode: AnalyticsErrorCode.InvalidInput,
          field: 'toLocalDate',
        },
      });
    }
  });
});

describe('AnalyticsPeriod — a YEAR', () => {
  it('runs 1 January to 31 December, and is held by any of its days', () => {
    const year = P.yearOf(TODAY);
    expect(year).toEqual({
      analyticsSpan: AnalyticsSpan.Year,
      fromLocalDate: localDate('2026-01-01'),
      toLocalDate: localDate('2026-12-31'),
    });
    expect(P.length(year)).toBe(365);
    expect(P.length(P.yearOf(localDate('2024-07-04')))).toBe(366);
    expect(P.holding(AnalyticsSpan.Year, localDate('2026-12-31'))).toEqual(
      year,
    );
  });

  it('is asked for from 1 January only', () => {
    expect(P.of(AnalyticsSpan.Year, localDate('2026-01-01'), null)).toEqual({
      ok: true,
      value: P.yearOf(TODAY),
    });
    expect(P.of(AnalyticsSpan.Year, localDate('2026-02-01'), null)).toEqual({
      ok: false,
      error: {
        errorCode: AnalyticsErrorCode.InvalidInput,
        field: 'fromLocalDate',
      },
    });
  });

  it('is compared with the year before', () => {
    expect(P.previous(P.yearOf(TODAY))).toEqual(
      P.yearOf(localDate('2025-06-15')),
    );
  });
});

describe('AnalyticsPeriod — a CUSTOM range', () => {
  const FROM = localDate('2026-09-07');
  const TO = localDate('2026-09-20');

  it('is any from ≤ to, both ends included', () => {
    expect(P.of(AnalyticsSpan.Custom, FROM, TO)).toEqual({
      ok: true,
      value: {
        analyticsSpan: AnalyticsSpan.Custom,
        fromLocalDate: FROM,
        toLocalDate: TO,
      },
    });
    expect(P.length(P.customOf(FROM, TO))).toBe(14);
    // A single day is a range too.
    expect(P.of(AnalyticsSpan.Custom, FROM, FROM).ok).toBe(true);
    // The one holding a day is that day.
    expect(P.holding(AnalyticsSpan.Custom, FROM)).toEqual(
      P.customOf(FROM, FROM),
    );
  });

  it('refuses a missing or inverted `to` as the field at fault', () => {
    const refused = {
      ok: false,
      error: {
        errorCode: AnalyticsErrorCode.InvalidInput,
        field: 'toLocalDate',
      },
    };
    expect(P.of(AnalyticsSpan.Custom, FROM, null)).toEqual(refused);
    expect(P.of(AnalyticsSpan.Custom, TO, FROM)).toEqual(refused);
  });

  it(`spans at most ${P.CUSTOM_MAX_DAYS} days — a leap year fits, a day more is out of range`, () => {
    expect(P.CUSTOM_MAX_DAYS).toBe(366);
    const leapYear = P.of(
      AnalyticsSpan.Custom,
      localDate('2024-01-01'),
      localDate('2024-12-31'),
    );
    expect(leapYear.ok && P.length(leapYear.value)).toBe(366);
    expect(
      P.of(
        AnalyticsSpan.Custom,
        localDate('2024-01-01'),
        localDate('2025-01-01'),
      ),
    ).toEqual({
      ok: false,
      error: {
        errorCode: AnalyticsErrorCode.PeriodOutOfRange,
        fromLocalDate: localDate('2024-01-01'),
      },
    });
  });

  it('is compared with the same length ending the day before', () => {
    expect(P.previous(P.customOf(FROM, TO))).toEqual(
      P.customOf(localDate('2026-08-24'), localDate('2026-09-06')),
    );
    expect(P.previous(P.customOf(FROM, FROM))).toEqual(
      P.customOf(localDate('2026-09-06'), localDate('2026-09-06')),
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
    // A YEAR starts on 1 January: this year is in reach, last year is not.
    expect(P.isWithinRange(P.yearOf(TODAY), TODAY)).toBe(true);
    expect(P.isWithinRange(P.yearOf(localDate('2025-10-01')), TODAY)).toBe(
      false,
    );
    expect(
      P.isWithinRange(
        P.yearOf(localDate('2025-06-01')),
        localDate('2026-01-15'),
      ),
    ).toBe(true);
    // A CUSTOM range is judged by its first day: it may run past today.
    expect(
      P.isWithinRange(
        P.customOf(localDate('2025-10-01'), localDate('2025-10-14')),
        TODAY,
      ),
    ).toBe(true);
    expect(
      P.isWithinRange(
        P.customOf(localDate('2025-09-30'), localDate('2025-10-14')),
        TODAY,
      ),
    ).toBe(false);
    expect(
      P.isWithinRange(P.customOf(TODAY, localDate('2026-10-20')), TODAY),
    ).toBe(true);
    expect(
      P.isWithinRange(
        P.customOf(localDate('2026-10-15'), localDate('2026-10-20')),
        TODAY,
      ),
    ).toBe(false);
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
    // A year: last year starts before the reach — the chip says so.
    expect(P.isComparable(P.yearOf(TODAY), TODAY)).toBe(false);
    expect(P.isComparable(P.yearOf(TODAY), localDate('2027-01-02'))).toBe(
      false,
    );
    // Until January: on 2 January 2026 the reach is 1 January 2025.
    expect(
      P.isComparable(
        P.yearOf(localDate('2026-01-02')),
        localDate('2026-01-02'),
      ),
    ).toBe(true);
    // A custom range: its comparison ends the day before it.
    expect(
      P.isComparable(
        P.customOf(localDate('2025-10-15'), localDate('2025-10-28')),
        TODAY,
      ),
    ).toBe(true);
    expect(
      P.isComparable(
        P.customOf(localDate('2025-10-14'), localDate('2025-10-28')),
        TODAY,
      ),
    ).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const period = deepFreeze(P.dayOf(TODAY));
    expect(P.previous(period)).toEqual(P.previous(period));
    expect(P.isComparable(period, TODAY)).toBe(P.isComparable(period, TODAY));
    expect(period).toEqual(P.dayOf(TODAY));
    const custom = deepFreeze(P.customOf(localDate('2026-09-07'), TODAY));
    expect(P.previous(custom)).toEqual(P.previous(custom));
    expect(custom).toEqual(P.customOf(localDate('2026-09-07'), TODAY));
  });
});
