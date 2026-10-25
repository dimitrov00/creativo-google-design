import { type TimeZone, defect } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { LOCATIONS } from '../../content/landing-content';

/**
 * The landing's two shops (D-14). The values keep an external contract's
 * spelling: they are the ids of the `LOCATIONS` entries in
 * `content/landing-content.ts` and the `landing.location.<id>.*` i18n key
 * segment. Deliberately NOT catalogue `LocationId`s — the static landing
 * content names its own two shops, it reads no stored location.
 */
export const LandingLocationId = {
  Center: 'center',
  Mladost: 'mladost',
} as const;
export type LandingLocationId =
  (typeof LandingLocationId)[keyof typeof LandingLocationId];

/**
 * A landing shop's IANA zone — its `LOCATIONS` entry's `timezone`, checked
 * with `ZonedTimeSystem.checkZone` (Law 7.2: the zone is configuration of
 * the shop location, and «open now» is the SHOP's clock, never the
 * visitor's device). The static landing content is the one home of the zone
 * string, so no zone literal enters the locations section. A missing entry
 * or an unknown zone is a broken constant, a programmer defect.
 */
export function landingLocationZone(locationId: LandingLocationId): TimeZone {
  const entry = LOCATIONS.find((location) => location.id === locationId);
  if (entry === undefined) {
    return defect(`landing location ${locationId} is not in LOCATIONS`);
  }
  const zone = ZonedTimeSystem.checkZone(entry.timezone);
  return zone.ok
    ? zone.value
    : defect(`landing location ${locationId}: unknown zone ${entry.timezone}`);
}
