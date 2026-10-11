import type {
  LocationStatus,
  GeoPoint,
  LocalizedText,
  MediaRef,
  DayHours,
  VenuePhone,
} from '@core/components';
import type { LocationId, MediaRefId, TimeZone } from '@core/primitives';

/**
 * The identity slice of a shop: the id and the plain attributes.
 *
 * Every optional of the legacy props is explicit: `shortName` (what a line
 * that already knows the business calls the shop — «Център» for «Креативо ·
 * Център»; `null` means the shop goes by `name`) and `mapUrl` are `null` when
 * absent and `photos` is `[]`. `openingHours` holds seven `DayHours`, Monday
 * first (index `weekday − 1`), the closed day kept.
 *
 * **`timeZone` is configuration of the location only** (Law 7.2, the
 * physical chair invariant, owner-locked): the IANA zone every wall-clock
 * coordinate of this shop — appointments, exceptions, busy days — is read
 * in, at the ingestion boundary, by `ZonedTimeSystem`. No temporal entity
 * carries a zone of its own.
 */
export type ShopLocationMeta = {
  readonly id: LocationId;
  readonly name: LocalizedText;
  readonly shortName: LocalizedText | null;
  readonly address: LocalizedText;
  readonly mapUrl: string | null;
  readonly photos: readonly MediaRef[];
  readonly openingHours: readonly DayHours[];
  readonly timeZone: TimeZone;
  readonly locationStatus: LocationStatus;
  readonly sortOrder: number;
};

/**
 * The shop's cover — the 1-to-1 `cover: MediaRef | null` flattened by prefix
 * (N9): the seven `MediaRef` fields, ALL `null` together.
 */
export type ShopCover = {
  readonly coverMediaId: MediaRefId | null;
  readonly coverMediaPath: string | null;
  readonly coverMediaWidth: number | null;
  readonly coverMediaHeight: number | null;
  readonly coverMediaBlurhash: string | null;
  readonly coverMediaFocalX: number | null;
  readonly coverMediaFocalY: number | null;
};

/**
 * A physical shop — `locations/{id}` (`location.ts:50-60`,
 * `catalog-reader.adapter.ts:209-222`), owner-locked as `ShopLocation`
 * (F-17: `Location` would shadow the DOM global). Every 1-to-1 field at the
 * root (Law 6): the identity slice, the `GeoPoint` slice (`latitude`,
 * `longitude`), the `VenuePhone` slice (`phoneE164`, `phoneDisplay`) and the
 * cover. The stored body keeps its legacy `geo`, `phone`, `cover`, `hours`
 * (clock text), `timezone` and `status` until the booking-core flip; the
 * shims convert.
 */
export type ShopLocation = ShopLocationMeta & GeoPoint & VenuePhone & ShopCover;
