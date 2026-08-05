/**
 * The calendar's cost ceiling, as a document: `capacity/{YYYY-MM}`.
 *
 * The busy projection is one doc per (barber, day), so a calendar spanning a
 * two-month horizon paid `barbers × occupied days` reads per cold mount —
 * ~75–130 at three barbers and ~920 at ten, which crosses the free tier on
 * its own. This rollup is the flattening: one doc per MONTH holding every
 * day's free minutes, per barber, per shop. The calendar listens to the two
 * or three months in its horizon and nothing else; cost stops scaling with
 * headcount entirely.
 *
 * ### Shape
 * ```
 * capacity/2026-08 = {
 *   month: '2026-08',
 *   days: {
 *     '2026-08-14': {
 *       ivan:   { 'loc-center': 240 },
 *       stefan: { 'loc-center': 180, 'loc-mladost': 60 },
 *     },
 *   },
 * }
 * ```
 * Per-barber, per-location, deliberately: the calendar filters by chosen
 * shop and by the roster the catalog currently knows, and a pre-summed
 * total could answer neither. A barber with nothing free (or no roster)
 * simply has no entry — absent and zero render identically.
 *
 * ### It is a PROJECTION, and the server recomputes it
 * Functions triggers rebuild affected entries from the same
 * `buildDayWindows` math the commit re-check runs (busy write → one day;
 * exception write → one day; roster write → the whole horizon; a daily
 * sweep as the safety net that also rolls new months into existence).
 * Nothing client-side ever writes here, and `commitBooking` never reads it
 * — the authority stays the geometry, exactly as with `barberBusy`.
 *
 * PII posture: identical to the busy docs it summarizes — minutes and shop
 * ids, no client, no service, no reason.
 */
export const CAPACITY_COLLECTION = 'capacity';

/** `2026-08-14` → `2026-08`. */
export function capacityMonthKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** One barber's free minutes on one day, keyed by `LocationId.value`. */
export type CapacityContribution = Readonly<Record<string, number>>;

/**
 * One day's entry as stored: barber id → contribution. `unknown`-tolerant
 * parsing lives in {@link freeMinutesFor} so a malformed entry degrades to
 * zero for that barber rather than poisoning the day.
 */
export type CapacityDayEntry = Readonly<Record<string, unknown>>;

/**
 * Sum a day's free minutes for the barbers the caller knows, optionally
 * narrowed to one shop — the ONE place the rollup's read semantics live, so
 * the calendar and any future consumer cannot disagree about them.
 */
export function freeMinutesFor(
  dayEntry: CapacityDayEntry | undefined,
  barberIds: readonly string[],
  locationId: string | null,
): number {
  if (!dayEntry) return 0;
  let total = 0;
  for (const barberId of barberIds) {
    const contribution = dayEntry[barberId];
    if (typeof contribution !== 'object' || contribution === null) continue;
    if (locationId !== null) {
      const minutes = (contribution as Record<string, unknown>)[locationId];
      total += Number.isFinite(Number(minutes)) ? Number(minutes) : 0;
      continue;
    }
    for (const minutes of Object.values(contribution)) {
      total += Number.isFinite(Number(minutes)) ? Number(minutes) : 0;
    }
  }
  return total;
}
