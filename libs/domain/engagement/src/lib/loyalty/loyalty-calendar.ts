import { ZonedDateTime } from '@creativo/domain/kernel';

/**
 * The shop's calendar. Every loyalty DATE — a season's window, the day a
 * level was earned, «днес» for a phase — is a day in this zone; instants
 * stay instants (`Date`) until one of them has to become a day.
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A real day in `YYYY-MM-DD` form — `2026-02-30` is refused, not rolled into March. */
export function isIsoDate(raw: unknown): raw is IsoDate {
  if (typeof raw !== 'string' || !ISO_DATE.test(raw)) return false;
  const ms = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(raw);
}

/** The Sofia day an instant falls on — the day a level was earned, a season announced. */
export function sofiaDayOf(at: Date): IsoDate {
  const zoned = ZonedDateTime.fromMillis(at.getTime(), LOYALTY_ZONE);
  if (zoned.isFailure()) {
    // Unreachable: the zone is a constant IANA name.
    throw zoned.error;
  }
  return zoned.value.toISODate();
}

/**
 * Whole calendar days from `from` to `to`, negative when `to` comes first.
 * Two dates, no instant between them, so no zone and no DST: a date is
 * placed at UTC midnight only to count.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      DAY_MS,
  );
}
