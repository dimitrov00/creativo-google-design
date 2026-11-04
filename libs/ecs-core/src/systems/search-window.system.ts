import { BookingPolicy, DateRange } from '@core/components';
import { LocalDate, UtcEpochMs, type TimeZone } from '@core/primitives';
import { ZonedTimeSystem } from './zoned-time.system';

/** How many days back the staff search reaches. */
const SEARCH_PAST_DAYS = 60;

/** A loaded window older than this is read again when the search opens. */
const SEARCH_WINDOW_MAX_AGE_MINUTES = 15;

/** The most visits read on each side of now — a misconfigured horizon cannot read the whole collection. */
const SEARCH_CAP_PER_SIDE = 3000;

const MS_PER_MINUTE = 60_000;

/**
 * The UTC instants a day range reads between, both inclusive — what the
 * appointment window port is asked for.
 */
export type SearchWindowBounds = {
  readonly fromUtcMs: UtcEpochMs;
  readonly toUtcMs: UtcEpochMs;
};

/**
 * SearchWindowSystem — how far the staff search reaches and when what it
 * loaded is too old to trust. The window is a DATE RANGE (the past
 * {@link SEARCH_PAST_DAYS} days up to the booking horizon), not a count, so
 * every visit anyone can book is findable; it is read again when it is
 * older than {@link SEARCH_WINDOW_MAX_AGE_MINUTES} or this device wrote a
 * visit since. Pure: shop days and branded instants only.
 */
export const SearchWindowSystem = {
  SEARCH_PAST_DAYS,
  SEARCH_WINDOW_MAX_AGE_MINUTES,
  SEARCH_CAP_PER_SIDE,

  /**
   * The shop days the window covers: `SEARCH_PAST_DAYS` before `today`
   * through the last bookable day (`BookingPolicy.horizonEndFrom`).
   */
  rangeOf(policy: BookingPolicy, today: LocalDate): DateRange {
    return DateRange.of(
      LocalDate.addDays(today, -SEARCH_PAST_DAYS),
      BookingPolicy.horizonEndFrom(policy, today),
    );
  },

  /**
   * The range as instants in the shop's zone: the first instant of its first
   * day through the last millisecond of its last day. Converted once, here,
   * at the ingestion boundary (Law 7) — the queries are then plain
   * `utcEpochMs` ranges.
   */
  boundsOf(range: DateRange, timeZone: TimeZone): SearchWindowBounds {
    return {
      fromUtcMs: ZonedTimeSystem.startOfLocalDay(range.fromLocalDate, timeZone),
      toUtcMs: UtcEpochMs.plusMs(
        ZonedTimeSystem.startOfLocalDay(
          LocalDate.addDays(range.toLocalDate, 1),
          timeZone,
        ),
        -1,
      ),
    };
  },

  /**
   * Must the window be read again? Yes when it was never loaded, when this
   * device wrote a visit since (`invalidated`), or when it is
   * {@link SEARCH_WINDOW_MAX_AGE_MINUTES} old or older. An elapsed-time rule
   * on a stamp (Law 7.3), so the clock going backwards never makes it stale.
   */
  isStale(
    loadedAtUtcMs: UtcEpochMs | null,
    nowUtcMs: UtcEpochMs,
    invalidated: boolean,
  ): boolean {
    if (loadedAtUtcMs === null || invalidated) return true;
    const expiresAt = UtcEpochMs.plusMs(
      loadedAtUtcMs,
      SEARCH_WINDOW_MAX_AGE_MINUTES * MS_PER_MINUTE,
    );
    return UtcEpochMs.compare(nowUtcMs, expiresAt) >= 0;
  },
} as const;
