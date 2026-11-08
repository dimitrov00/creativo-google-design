import type { MinuteOfDay } from './minute-of-day.primitive';

/** Minutes in an hour — the bucket's width. */
const MINUTES_PER_HOUR = 60;

/** The 24 hours of a shop day in order — the tag source of {@link HourOfDay}. */
const HOURS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23,
] as const;

/**
 * A wall-clock hour of the shop day, `0` … `23` — the bucket `[h:00,
 * h+1:00)` a minute of the day falls in, what the analytics hour grid
 * (`AnalyticsReport.HourCell.hour`) and a day's 24 hour buckets are indexed
 * by. A number, so it indexes a 24-entry array directly (as `Weekday` does
 * a seven-entry one); a point on the shop's clock, never an instant and
 * never a count of hours (`HourCount`). A DST day has 24 buckets too: the
 * wall clock names them.
 */
export type HourOfDay = (typeof HOURS)[number];

export const HourOfDay = {
  /** Every hour of the day, `0` first — a loop reads the hour from its index. */
  ALL: HOURS,

  /** How many hours a shop day has — the length of every per-hour array. */
  PER_DAY: HOURS.length,

  /** Foreign input as an hour of the day — an integer `0…23` — or not. */
  is(raw: unknown): raw is HourOfDay {
    return (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw < HOURS.length
    );
  },

  /** The hour a minute of the day falls in — `09:45` is hour `9`. */
  ofMinute(minute: MinuteOfDay): HourOfDay {
    return HOURS[Math.floor(minute / MINUTES_PER_HOUR)] as HourOfDay;
  },

  /** The first minute of the hour, `h × 60` — where its bucket `[h:00, h+1:00)` starts. */
  startMinute(hour: HourOfDay): MinuteOfDay {
    return (hour * MINUTES_PER_HOUR) as MinuteOfDay;
  },
} as const;
