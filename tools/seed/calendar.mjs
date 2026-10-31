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
 * The instant the calendar is anchored at is ONE injectable value
 * (`seedNowOf`: `--now=<text>`, env `SEED_NOW`, else the caller's live
 * clock), so a gate can pin "today" and its time of day — `verify:p0`
 * seeds twice at one instant, the e2e suite at its own day's 10:00.
 *
 * Loaded inside the seed's bundle (`load-domain.mjs`) and by the specs,
 * never by plain Node: it imports the `@core/*` tiers by alias.
 */
import { LocalDate, UtcEpochMs } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { SHOP_TIME_ZONE } from './fixtures/catalog.fixtures.ts';

const MINUTES_PER_DAY = 1440;

/** The environment variable that pins the seed's instant when no `--now=` is given. */
export const SEED_NOW_ENV = 'SEED_NOW';

/**
 * The human seed's default when no instant is given: the live clock
 * (audit-hardening Phase 3, P3-L-1 / P3-RU-1). The dev book is authored as a
 * LIVE day — today's visits settle once their time has passed — so a fixed
 * time of day would show every later visit as an unclosed past one. Every
 * GATE consumer pins the instant instead: `verify:p0` hands one instant to
 * both of its runs, the e2e global setup hands the suite's. Flipping this
 * default is the owner's call (Phase 3 plan §7 item 2).
 */
export const SEED_DEFAULT = 'LIVE';

/** The argv flag that pins the seed's instant: `--now=<text>`. */
const NOW_FLAG = '--now';

/** Epoch milliseconds, written as digits only. */
const EPOCH_DIGITS = /^\d+$/;

/**
 * Where the seed's instant was pinned, if anywhere: the LAST
 * `--now=<text>` of `argv` first, then env `SEED_NOW` (an empty value is
 * a value, and refused by {@link seedNowOf}); `null` when neither is given
 * — the seed then runs on `SEED_DEFAULT`. A bare `--now` (no `=`) throws:
 * the flag never takes the next argument.
 */
export function seedNowTextOf({ argv, env }) {
  let text = null;
  for (const arg of argv) {
    if (arg === NOW_FLAG) {
      throw new Error(
        `seed: ${NOW_FLAG} takes its instant after '=' (${NOW_FLAG}=<text>)`,
      );
    }
    if (arg.startsWith(`${NOW_FLAG}=`)) {
      text = arg.slice(NOW_FLAG.length + 1);
    }
  }
  if (text !== null) return { source: NOW_FLAG, text };
  const pinned = env[SEED_NOW_ENV];
  return pinned === undefined ? null : { source: SEED_NOW_ENV, text: pinned };
}

/**
 * The seed's instant (epoch ms, a `UtcEpochMs`): `--now=<text>` first, then
 * env `SEED_NOW`, else `realNowMs` (`SEED_DEFAULT`, the live clock). Never
 * reads a clock itself — the caller hands its own.
 *
 * `<text>` is one of:
 * - epoch milliseconds, digits only (`1793137200000`) — `UtcEpochMs.of`;
 * - a wall time ON THE SHOP'S CLOCK, `YYYY-MM-DDTHH:mm` (`2026-10-27T23:40`;
 *   a date alone is its midnight) — read on `timeZone` by
 *   `ZonedTimeSystem.parseIsoIn`: a time inside the spring-forward gap is
 *   refused (`DST_GAP_INVALID_TIME`), a fall-back repeat takes the EARLIER
 *   offset (Law 7.3);
 * - an ISO instant with `Z` or an offset (`2026-10-27T21:40Z`,
 *   `2026-10-27T23:40+02:00`).
 *
 * A refused text THROWS (`seed: --now '<text>' is no instant (<errorCode>)`)
 * — never a silent fall back to the clock.
 */
export function seedNowOf({ argv, env, realNowMs, timeZone = SHOP_TIME_ZONE }) {
  const pinned = seedNowTextOf({ argv, env });
  if (pinned === null) return realNowMs;
  const instant = EPOCH_DIGITS.test(pinned.text)
    ? UtcEpochMs.of(Number(pinned.text))
    : ZonedTimeSystem.parseIsoIn(pinned.text, timeZone);
  if (!instant.ok) {
    throw new Error(
      `seed: ${pinned.source} '${pinned.text}' is no instant (${instant.error.errorCode})`,
    );
  }
  return instant.value;
}

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
