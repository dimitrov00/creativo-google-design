import { DayKey, ZonedTimeSystem } from '@creativo/ecs-core';

/**
 * The shop's calendar. Every loyalty DATE — a season's window, the day a
 * level was earned, «днес» for a phase — is a day in this zone; instants
 * stay instants (`Date`) until one of them has to become a day.
 *
 * A thin shim since the ECS migration's Phase 2: the calendar arithmetic is
 * `DayKey` and `ZonedTimeSystem` (`@creativo/ecs-core`, native `Intl`, no
 * date library).
 */
export const LOYALTY_ZONE = 'Europe/Sofia';

/**
 * A Europe/Sofia calendar day, `YYYY-MM-DD` — sortable, so `<` and `>`
 * compare days. A plain alias rather than a brand on purpose: the card
 * hands its scope keys and «today» straight through (`day:2026-09-04`), and
 * the one place untrusted text becomes a date is the mapper, which checks
 * it with {@link isIsoDate}.
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;

/** A real day in `YYYY-MM-DD` form — `2026-02-30` is refused, not rolled into March. */
export function isIsoDate(raw: unknown): raw is IsoDate {
  return DayKey.isValid(raw);
}

/** The Sofia day an instant falls on — the day a level was earned, a season announced. */
export function sofiaDayOf(at: Date): IsoDate {
  const clock = ZonedTimeSystem.wallClockOf(at.getTime(), LOYALTY_ZONE);
  if (!clock.ok) {
    // Unreachable for a real instant: the zone is a constant IANA name.
    throw new RangeError(`${clock.error.code}: ${String(at)}`);
  }
  return clock.value.dayKey;
}

/**
 * Whole calendar days from `from` to `to`, negative when `to` comes first.
 * Two dates, no instant between them, so no zone and no DST. Text that is
 * no calendar day counts as it always did (`NaN` where it cannot be read).
 */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return DayKey.isValid(from) && DayKey.isValid(to)
    ? ZonedTimeSystem.daysBetween(DayKey.of(from), DayKey.of(to))
    : Math.round(
        (Date.parse(`${to}T00:00:00.000Z`) -
          Date.parse(`${from}T00:00:00.000Z`)) /
          DAY_MS,
      );
}
