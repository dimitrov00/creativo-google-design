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
