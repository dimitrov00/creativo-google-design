import type { ShopNow } from '@core/components';
import type { LocationId, UtcEpochMs } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import type { ShopZoneAnswer } from './shop-zone.service';

/*
 * EACH VISIT ON ITS OWN SHOP'S CLOCK (OR-8) — the web's one way of turning
 * a set of visits into the per-shop "now" `VisitListSystem.nextUpcoming` /
 * `countUpcoming` / `isHistory` judge them on. The menu's badge, `/account`'s
 * card and `/account/appointments` all read their visits' shops, ask
 * {@link ShopZoneService.zonesOf} for those shops' zones, and fold the
 * answers into one `nowOf` — written ONCE here, so the three can never
 * judge the same visit on different clocks. Pure: no Angular, no read.
 */

/**
 * The shops the items are at, each once, in code-unit order — a zone
 * read's one input. Structural: a caller passes whichever visits it
 * judges (all of them, or only the unsettled ones).
 */
export function distinctLocationIds(
  items: Iterable<{ readonly locationId: LocationId }>,
): readonly LocationId[] {
  const ids = new Set<LocationId>();
  for (const item of items) ids.add(item.locationId);
  return [...ids].sort();
}

/**
 * Two shop lists are the same read: the same ids, in the same order — the
 * `equal` of a signal feeding a zone read, so a snapshot at shops already
 * listed reads nothing. `undefined` (no list) equals only itself.
 */
export function sameLocationIds(
  a: readonly LocationId[] | undefined,
  b: readonly LocationId[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((id, index) => id === b.at(index));
}

/**
 * The zone answers, by shop, folded into "now" on each shop's OWN wall
 * clock at `atUtcMs` (`ZonedTimeSystem.shopNow`, Law 7.3) — read once per
 * shop, never per visit. The lookup answers `null` for a shop whose zone
 * could not be read, for one not asked, and for every shop while the
 * answers are on their way (`answers` `null`): nothing is judged on a
 * clock that is not known.
 */
export function nowOfZones(
  answers: ReadonlyMap<LocationId, ShopZoneAnswer> | null,
  atUtcMs: UtcEpochMs,
): (locationId: LocationId) => ShopNow | null {
  const nows = new Map<LocationId, ShopNow>();
  if (answers !== null) {
    for (const [locationId, answer] of answers) {
      if (answer.ok) {
        nows.set(locationId, ZonedTimeSystem.shopNow(atUtcMs, answer.value));
      }
    }
  }
  return (locationId) => nows.get(locationId) ?? null;
}
