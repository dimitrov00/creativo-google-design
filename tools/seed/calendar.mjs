/**
 * The shop's calendar for the dev seed: day offsets from TODAY ON THE SHOP'S
 * CLOCK, turned into shop days (`dayKeyAt`, the bodies' `localDate`), ISO
 * weekdays (`weekdayAt`) and the epoch-ms instants the bodies store (`msAt`,
 * every `*UtcMs`). Every conversion is `ZonedTimeSystem`'s (Law 7.3) and
 * every day step `LocalDate`'s, on the zone the default shop's seeded body
 * holds (`SHOP_TIME_ZONE`, `fixtures/catalog.fixtures.ts`) — never a second
 * copy of the zone, nor of the engine that reads it.
 *
 * The seed used to derive days from the MACHINE's local midnight and only
 * borrow Sofia's offset for the string — right on a Sofia laptop, a day out
 * on a UTC runner after 21:00. Eighteen months of history cross three DST
 * changes; each wall time is read on its own day's offset, and the shop is
 * closed at every switch (03:00 in Sofia), so no seeded time falls in a
 * spring-forward gap — one that did would stop the seed
 * (`DST_GAP_INVALID_TIME`), never move silently.
 *
 * Loaded inside the seed's bundle (`load-domain.mjs`) and by the specs,
 * never by plain Node: it imports the `@core/*` tiers by alias.
 */
import { LocalDate } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { SHOP_TIME_ZONE } from './fixtures/catalog.fixtures.ts';

const MINUTES_PER_DAY = 1440;

/** The shop's wall clock at an instant: `{ localDate, minute }`. */
export function shopWallAt(utcMs, timeZone = SHOP_TIME_ZONE) {
  return ZonedTimeSystem.toLocal(utcMs, timeZone);
}

/** A shop day's first instant — its midnight on the shop's clock. */
export function shopMidnightOf(localDate, timeZone = SHOP_TIME_ZONE) {
  return ZonedTimeSystem.startOfLocalDay(localDate, timeZone);
}

/**
 * A calendar anchored at `nowMs`: offset 0 is the shop's today, whatever the
 * machine's zone. Everything the seed dates goes through one of these, so a
 * test can pin "now" and get the same documents the seed would write.
 */
export function createShopCalendar(nowMs, timeZone = SHOP_TIME_ZONE) {
  const { localDate: today } = ZonedTimeSystem.shopNow(nowMs, timeZone);

  /** The shop day `offset` days from today, `YYYY-MM-DD`. */
  const dayKeyAt = (offset) => LocalDate.addDays(today, offset);

  /** `Weekday`: 1 = Monday … 7 = Sunday. */
  const weekdayAt = (offset) => LocalDate.weekday(dayKeyAt(offset));

  /** `dayKeyAt`'s inverse: the offset of a `YYYY-MM-DD` shop day from today. */
  const offsetOf = (localDate) => LocalDate.daysBetween(today, localDate);

  /**
   * The instant `minutes` past midnight of the shop day `offset` days from
   * today. Minutes past the day's end roll into the next day (and negative
   * ones back into the day before) rather than reading `24:15`. Refuses a
   * wall time the shop's clock skips.
   */
  const msAt = (offset, minutes) => {
    const days = Math.floor(minutes / MINUTES_PER_DAY);
    const localDate = dayKeyAt(offset + days);
    const minute = minutes - days * MINUTES_PER_DAY;
    const instant = ZonedTimeSystem.toUtc(localDate, minute, timeZone);
    if (!instant.ok) {
      throw new Error(
        `seed: ${localDate} at minute ${minute} is no time of ${timeZone} (${instant.error.errorCode})`,
      );
    }
    return instant.value;
  };

  return {
    nowMs,
    zone: timeZone,
    today,
    dayKeyAt,
    offsetOf,
    weekdayAt,
    msAt,
  };
}
