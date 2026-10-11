import type { LocalDate } from '../primitives/local-date.primitive';
import type { MinuteOfDay } from '../primitives/minute-of-day.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { WallTime } from './wall-time.data';

/**
 * "Now" as the shop sees it (Law 7.3, owner-locked 2026-10-10) — derived ONCE
 * per request at the ingestion boundary by `ZonedTimeSystem.shopNow` from the
 * location's `timeZone`, then handed to systems, which stay time-zone-blind:
 *
 * - `localDate` + `currentMinute` — the shop's wall clock: EVERY comparison and
 *   calculation ("is it today", "is it upcoming", lead floors, windows);
 * - `utcEpochMs` — the same instant, ONLY to stamp lifecycle instants
 *   (`confirmedAtUtcMs`, `cancelledAtUtcMs`, …), never for math.
 */
export type ShopNow = {
  readonly localDate: LocalDate;
  readonly currentMinute: MinuteOfDay;
  readonly utcEpochMs: UtcEpochMs;
};

export const ShopNow = {
  of(
    localDate: LocalDate,
    currentMinute: MinuteOfDay,
    utcEpochMs: UtcEpochMs,
  ): ShopNow {
    return { localDate, currentMinute, utcEpochMs };
  },

  /** The shop wall clock of "now", as a {@link WallTime}. */
  wallTime(now: ShopNow): WallTime {
    return WallTime.of(now.localDate, now.currentMinute);
  },
} as const;
