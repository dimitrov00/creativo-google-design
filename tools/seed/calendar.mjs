/**
 * The shop's calendar for the dev seed: day offsets from TODAY IN SOFIA,
 * turned into the `{iso, zone}` strings `appointmentToDocument` writes.
 *
 * The seed used to derive days from the MACHINE's local midnight and only
 * borrow Sofia's offset for the string — right on a Sofia laptop, a day out
 * on a UTC runner after 21:00. Eighteen months of history cross three DST
 * changes, so the offset is now looked up for each wall time on its own day.
 */

export const SHOP_ZONE = 'Europe/Sofia';

const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 1440;

const pad = (n) => String(n).padStart(2, '0');

/** The shop's calendar date at an instant. */
export function shopDateAt(ms, zone = SHOP_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const field = (type) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: field('year'), month: field('month'), day: field('day') };
}

/** The zone's UTC offset at an instant, in minutes east of UTC. */
function offsetMinutesAt(ms, zone) {
  const name =
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(ms))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function formatOffset(minutes) {
  if (minutes === 0) return 'Z';
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const WALL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}\.\d{3})/;

/**
 * A wall-clock time of the zone, moved by whole days: the same reading of
 * the clock on another date, with the offset THAT date has —
 * `2026-12-31T23:59:59.999+02:00` moved 200 days on is
 * `2027-07-19T23:59:59.999+03:00`. How a dated fixture follows the shop's
 * today: to the millisecond, across any number of DST changes.
 *
 * Refuses a string that is not the zone's own wall time (an instant
 * spelled in UTC, say): moving its digits would move another moment.
 */
export function wallTimeMovedBy(iso, days, zone = SHOP_ZONE) {
  const match = WALL_TIME.exec(iso);
  if (!match) throw new Error(`seed: ${iso} is no wall time`);
  const [, date, time] = match;
  const at = (day) => {
    // Read the wall time as if it were UTC, then correct by the offset in
    // force at the corrected instant — twice, which settles the DST days.
    const wall = Date.parse(`${day}T${time}Z`);
    const first = offsetMinutesAt(wall, zone);
    const offsetMin = offsetMinutesAt(wall - first * 60_000, zone);
    return `${day}T${time}${formatOffset(offsetMin)}`;
  };
  if (Date.parse(at(date)) !== Date.parse(iso)) {
    throw new Error(`seed: ${iso} is not a wall time of ${zone}`);
  }
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
  return at(moved.toISOString().slice(0, 10));
}

/**
 * A calendar anchored at `nowMs`: offset 0 is the shop's today, whatever the
 * machine's zone. Everything the seed dates goes through one of these, so a
 * test can pin "now" and get the same documents the seed would write.
 */
export function createShopCalendar(nowMs, zone = SHOP_ZONE) {
  const today = shopDateAt(nowMs, zone);
  // Calendar arithmetic on a UTC midnight never meets a DST gap.
  const base = Date.UTC(today.year, today.month - 1, today.day);

  const dayKeyAt = (offset) => {
    const date = new Date(base + offset * DAY_MS);
    return [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join('-');
  };

  /** 0 = Sunday … 6 = Saturday, like `Date#getDay`. */
  const weekdayAt = (offset) => new Date(base + offset * DAY_MS).getUTCDay();

  /** `dayKeyAt`'s inverse: the offset of a `YYYY-MM-DD` shop day from today. */
  const offsetOf = (dayKey) =>
    Math.round((Date.parse(`${dayKey}T00:00:00Z`) - base) / DAY_MS);

  /**
   * `2026-09-25T10:00:00.000+03:00` — a wall-clock time on the shop's day
   * with the offset that day really has. Minutes past midnight roll into the
   * next day rather than printing `24:15`.
   */
  const isoAt = (offset, hour, minute = 0) => {
    const total = hour * 60 + minute;
    const day = offset + Math.floor(total / MINUTES_PER_DAY);
    const inDay =
      ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const h = Math.floor(inDay / 60);
    const m = inDay % 60;
    // Read the wall time as if it were UTC, then correct by the offset in
    // force at the corrected instant — twice, which settles the DST days.
    const wall = base + day * DAY_MS + inDay * 60_000;
    const first = offsetMinutesAt(wall, zone);
    const offsetMin = offsetMinutesAt(wall - first * 60_000, zone);
    return `${dayKeyAt(day)}T${pad(h)}:${pad(m)}:00.000${formatOffset(offsetMin)}`;
  };

  const msAt = (offset, hour, minute = 0) =>
    Date.parse(isoAt(offset, hour, minute));

  return {
    nowMs,
    zone,
    today,
    dayKeyAt,
    offsetOf,
    weekdayAt,
    isoAt,
    msAt,
  };
}
