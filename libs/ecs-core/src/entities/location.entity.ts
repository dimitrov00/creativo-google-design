import type { LocationState } from '../components/catalog-status.data';
import type { GeoPoint } from '../components/geo-point.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { MediaRef } from '../components/media-ref.data';
import type { DayHours } from '../components/opening-hours.data';
import type { VenuePhone } from '../components/venue-phone.data';

export type LocationId = string & { readonly __brand: unique symbol };
export const LocationId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): LocationId => raw as LocationId,
} as const;

/**
 * A physical shop — `locations/{id}` (`location.ts:50-60`,
 * `catalog-reader.adapter.ts:209-222`).
 *
 * Every optional of the legacy props is explicit: `shortName` (what a line
 * that already knows the business calls the shop — «Център» for «Креативо ·
 * Център»; `null` means the shop goes by `name`), `mapUrl`, `cover` are
 * `null` when absent and `photos` is `[]`. `openingHours` holds seven
 * `DayHours`, Monday first (index `weekday − 1`), the closed day kept;
 * `zone` is the IANA zone every slot at this shop is materialised in.
 *
 * **Declared renames** (blueprint §2.6, repeated in §3.1): `hours` →
 * `openingHours` with `'HH:mm'` → minutes-of-day, and `timezone` → `zone`
 * (one spelling of the zone field across every entity).
 */
export type LocationEntity = {
  readonly id: LocationId;
  readonly name: LocalizedText;
  readonly shortName: LocalizedText | null;
  readonly address: LocalizedText;
  readonly geo: GeoPoint;
  readonly phone: VenuePhone;
  readonly mapUrl: string | null;
  readonly cover: MediaRef | null;
  readonly photos: readonly MediaRef[];
  readonly openingHours: readonly DayHours[];
  readonly zone: string;
  readonly status: LocationState;
  readonly sortOrder: number;
};
