import { describe, expect, it } from 'vitest';
import { BookingPolicy } from '@core/components';
import { UtcEpochMs } from '@core/primitives';
import { FIXTURE_TIME_ZONE, deepFreeze, localDate, utcMs } from '@core/testing';
import { SearchWindowSystem } from './search-window.system';

const policyOf = (horizonMonths: number): BookingPolicy => ({
  ...BookingPolicy.DEFAULT,
  horizonMonths,
});

describe('SearchWindowSystem.rangeOf — the days the search reaches', () => {
  it('reaches 60 days back and to the end of the horizon (two months by default)', () => {
    const range = SearchWindowSystem.rangeOf(
      BookingPolicy.DEFAULT,
      localDate('2026-08-05'),
    );
    expect(range.fromLocalDate).toBe('2026-06-06');
    expect(range.toLocalDate).toBe('2026-10-31');
  });

  it('follows the policy’s horizon', () => {
    expect(
      SearchWindowSystem.rangeOf(policyOf(1), localDate('2026-08-05'))
        .toLocalDate,
    ).toBe('2026-09-30');
    expect(
      SearchWindowSystem.rangeOf(policyOf(6), localDate('2026-08-05'))
        .toLocalDate,
    ).toBe('2027-02-28');
  });

  it('ends on the last day of a month, never a clamped one (month-end rollover)', () => {
    const range = SearchWindowSystem.rangeOf(
      BookingPolicy.DEFAULT,
      localDate('2026-12-31'),
    );
    expect(range.fromLocalDate).toBe('2026-11-01');
    expect(range.toLocalDate).toBe('2027-02-28');
  });

  it('crosses a leap day in the past reach', () => {
    expect(
      SearchWindowSystem.rangeOf(BookingPolicy.DEFAULT, localDate('2028-03-01'))
        .fromLocalDate,
    ).toBe('2028-01-01');
  });
});

describe('SearchWindowSystem.boundsOf — the range as instants in the shop zone', () => {
  const range = SearchWindowSystem.rangeOf(
    BookingPolicy.DEFAULT,
    localDate('2026-08-05'),
  );

  it('runs from the first instant of the first day to the last millisecond of the last', () => {
    const { fromUtcMs, toUtcMs } = SearchWindowSystem.boundsOf(
      range,
      FIXTURE_TIME_ZONE,
    );
    // Europe/Sofia is UTC+3 in summer (06-06) and UTC+2 in winter (10-31 is
    // still summer time: DST ends 10-25, so 10-31 is UTC+2).
    expect(fromUtcMs).toBe(utcMs('2026-06-06T00:00:00+03:00'));
    expect(toUtcMs).toBe(utcMs('2026-10-31T23:59:59.999+02:00'));
  });

  it('is inclusive of the last day and exclusive of the day after', () => {
    const { toUtcMs } = SearchWindowSystem.boundsOf(range, FIXTURE_TIME_ZONE);
    expect(
      UtcEpochMs.compare(toUtcMs, utcMs('2026-11-01T00:00:00+02:00')),
    ).toBe(-1);
  });
});

describe('SearchWindowSystem.isStale — when to read the window again', () => {
  const loaded = utcMs('2026-08-05T09:00:00+03:00');
  const at = (iso: string) => utcMs(iso);

  it('is stale when it was never loaded', () => {
    expect(SearchWindowSystem.isStale(null, loaded, false)).toBe(true);
  });

  it('is fresh at 14 minutes and stale at 15 and 16', () => {
    expect(
      SearchWindowSystem.isStale(
        loaded,
        at('2026-08-05T09:14:00+03:00'),
        false,
      ),
    ).toBe(false);
    expect(
      SearchWindowSystem.isStale(
        loaded,
        at('2026-08-05T09:15:00+03:00'),
        false,
      ),
    ).toBe(true);
    expect(
      SearchWindowSystem.isStale(
        loaded,
        at('2026-08-05T09:16:00+03:00'),
        false,
      ),
    ).toBe(true);
  });

  it('is stale at once when this device wrote a visit', () => {
    expect(SearchWindowSystem.isStale(loaded, loaded, true)).toBe(true);
  });

  it('is not made stale by a clock that went backwards', () => {
    expect(
      SearchWindowSystem.isStale(
        loaded,
        at('2026-08-05T08:00:00+03:00'),
        false,
      ),
    ).toBe(false);
  });

  it('names its figures in one place', () => {
    expect(SearchWindowSystem.SEARCH_PAST_DAYS).toBe(60);
    expect(SearchWindowSystem.SEARCH_WINDOW_MAX_AGE_MINUTES).toBe(15);
    expect(SearchWindowSystem.SEARCH_CAP_PER_SIDE).toBe(3000);
  });
});

describe('SearchWindowSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const policy = deepFreeze({ ...BookingPolicy.DEFAULT });
    const today = localDate('2026-08-05');
    expect(SearchWindowSystem.rangeOf(policy, today)).toEqual(
      SearchWindowSystem.rangeOf(policy, today),
    );
    const range = deepFreeze(SearchWindowSystem.rangeOf(policy, today));
    expect(SearchWindowSystem.boundsOf(range, FIXTURE_TIME_ZONE)).toEqual(
      SearchWindowSystem.boundsOf(range, FIXTURE_TIME_ZONE),
    );
  });
});
