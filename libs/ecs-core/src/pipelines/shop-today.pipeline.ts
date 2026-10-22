import {
  type LocalDate,
  type RepositoryError,
  Result,
  type TimeZone,
} from '@core/primitives';
import type {
  ClockPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
} from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

export type ShopTodayPorts = ClockPorts &
  LocationLoadPorts &
  DefaultLocationPorts;

/**
 * THE SHOP'S DAY NOW where no location is in scope (flip-3 plan F3-10;
 * Phase 4a 4A-11) — the loyalty catalogue's memo key: the clock read on
 * every call, placed on the wall clock of the deployment's DEFAULT location
 * (no tenant-zone constant survives, flatten-spec F-4).
 *
 * The zone is `readShopZone(null)` — the one zone read, its refusal already
 * folded into the store failure a boundary answers (4A-2 (e)) — read ONCE
 * and kept for the session: a read in flight is shared, a failed one is not
 * kept, so the next call reads again. A tab left open past the shop's
 * midnight keys the memo by the new day.
 *
 * The web binds it inside the lazy firebase-data scope (`app.config.ts`,
 * through the lazy Firestore module's named re-export), so `@core/pipelines`
 * and `@core/systems` stay out of the initial chunk (phase-4a §9 R10).
 */
export const shopToday = (
  ports: ShopTodayPorts,
): (() => Promise<Result<LocalDate, RepositoryError>>) => {
  const read = readShopZone(ports);
  let zone: Promise<Result<TimeZone, RepositoryError>> | null = null;

  return async () => {
    if (zone === null) {
      const reading = read(null);
      zone = reading;
      void reading.then((answer) => {
        if (!answer.ok && zone === reading) zone = null;
      });
    }
    const answer = await zone;
    return answer.ok
      ? Result.ok(
          ZonedTimeSystem.toLocal(ports.nowUtcMs(), answer.value).localDate,
        )
      : answer;
  };
};
