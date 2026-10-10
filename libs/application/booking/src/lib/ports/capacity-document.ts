import {
  BarberId as EcsBarberId,
  CapacityEntry,
  DayKey as EcsDayKey,
  LocationId as EcsLocationId,
} from '@creativo/ecs-core';

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
  return CapacityEntry.monthOf(EcsDayKey.of(dayKey));
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
  const day = EcsDayKey.of(ANY_DAY);
  return CapacityEntry.freeMinutesOn(
    entriesOf(dayEntry, barberIds, day),
    day,
    barberIds.map((id) => EcsBarberId.of(id)),
    locationId === null ? null : EcsLocationId.of(locationId),
  );
}

// ── The bridge: the stored day map → ecs-core entries (Phase 4 deletes it) ─

/** Every entry of a converted day shares one key — any will do. */
const ANY_DAY = '0000-00-00';

/**
 * The day's map as `CapacityEntry` rows, for the barbers asked about, in
 * their order (a barber named twice is counted twice, as before). A
 * malformed contribution is no entry; a malformed figure is `0`.
 */
function entriesOf(
  dayEntry: CapacityDayEntry,
  barberIds: readonly string[],
  dayKey: EcsDayKey,
): readonly CapacityEntry[] {
  const entries: CapacityEntry[] = [];
  for (const barberId of barberIds) {
    const contribution = dayEntry[barberId];
    if (typeof contribution !== 'object' || contribution === null) continue;
    for (const [locationId, minutes] of Object.entries(contribution)) {
      entries.push({
        dayKey,
        barberId: EcsBarberId.of(barberId),
        locationId: EcsLocationId.of(locationId),
        freeMinutes: Number.isFinite(Number(minutes)) ? Number(minutes) : 0,
      });
    }
  }
  return entries;
}
