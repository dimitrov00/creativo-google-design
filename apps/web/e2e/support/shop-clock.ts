/**
 * THE SHOP'S CLOCK, ONCE, for the e2e suite — the one zone source every
 * support module and spec reads: the shop's zone checked once through
 * `ZonedTimeSystem.checkZone`, its today through `ZonedTimeSystem.shopNow`,
 * an instant's shop day through `ZonedTimeSystem.toLocal` and a wall-clock
 * moment through `ZonedTimeSystem.toUtc` — the zone engine the app itself
 * runs (Law 7), never a second `Intl` reading of the zone.
 *
 * Firebase-free and Node-free on purpose: `appointment-seed-document.ts`
 * builds on it, and the web unit-test build compiles that one too.
 */
import {
  LocalDate,
  MinuteOfDay,
  type Result,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';

/** A smart constructor's answer for a value that is one by construction — a refusal fails the run loudly. */
export function sure<T, E>(result: Result<T, E>, what: string): T {
  if (!result.ok) throw new Error(`e2e seed: ${what} is not valid`);
  return result.value;
}

/** The shop's zone: every seeded slot is shop time. */
export const SHOP_ZONE = 'Europe/Sofia';

/** The shop's zone, checked once at this edge. */
export const SHOP_TIME_ZONE: TimeZone = sure(
  ZonedTimeSystem.checkZone(SHOP_ZONE),
  SHOP_ZONE,
);

/** An instant on the shop's wall clock — `day` at `hour:minute`, read in its zone. */
export function shopInstant(day: string, hour: number, minute = 0): UtcEpochMs {
  return sure(
    ZonedTimeSystem.toUtc(
      sure(LocalDate.parse(day), day),
      sure(MinuteOfDay.of(hour * 60 + minute), `${hour}:${minute}`),
      SHOP_TIME_ZONE,
    ),
    `${day} ${hour}:${minute}`,
  );
}

/** The shop day an instant falls on — `YYYY-MM-DD`, whatever the device's zone. */
export function shopDayOf(at: UtcEpochMs): LocalDate {
  return ZonedTimeSystem.toLocal(at, SHOP_TIME_ZONE).localDate;
}

/** Today on the shop's wall clock — `YYYY-MM-DD`, whatever the device's zone. */
export function shopToday(): LocalDate {
  return ZonedTimeSystem.shopNow(
    sure(UtcEpochMs.of(Date.now()), 'now'),
    SHOP_TIME_ZONE,
  ).localDate;
}

/** The evening start a seeded "today" visit takes while the shop's clock allows it. */
const EVENING_START = 21 * 60;

/** The latest start a 30-minute chair visit still ends today on (23:55). */
const LATEST_START = 23 * 60 + 25;

/**
 * A start STILL AHEAD on today's shop clock, as the naive wall time
 * `HH:mm:00` a seed reads: 21:00 — or, once the shop's clock is past 20:50,
 * the first five-minute step at least ten minutes ahead — so a visit
 * seeded today is still to come (open, not yet started:
 * `VisitStorySystem.isUpcoming`) while the spec reads it. Capped at 23:25,
 * so the dev chair's 30-minute visit ends today: a run started after about
 * 23:15 can no longer seed an hour still to come today.
 */
export function stillAheadToday(): string {
  const now = ZonedTimeSystem.shopNow(
    sure(UtcEpochMs.of(Date.now()), 'now'),
    SHOP_TIME_ZONE,
  );
  const soonest = Math.ceil((now.currentMinute + 10) / 5) * 5;
  const start = Math.min(Math.max(EVENING_START, soonest), LATEST_START);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(start / 60))}:${pad(start % 60)}:00`;
}
