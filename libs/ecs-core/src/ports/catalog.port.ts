import type { Observable } from 'rxjs';
import type { Result, LocationId, ServiceId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type {
  Barber,
  ServiceCategory,
  Service,
  ShopLocation,
} from '@core/entities';

/**
 * The catalogue's read ports (blueprint §4.2) — one function per query
 * shape, the entities straight from `snap.data()` (no mapper), every one
 * naming its error: `Result<X, RepositoryError>`. Successor of the
 * application layer's `CatalogReader` (`catalog-reader.port.ts`) and the
 * functions' own catalogue reads (`request-waitlist.ts:130-170`). The web
 * streams list the WHOLE active catalogue — every reader wants all of it —
 * so no query filters on `categoryId` or `locationIds`.
 */

/** Live ACTIVE services of every category, `orderBy sortOrder` (index #2). */
export type ObserveServices = () => Observable<
  Result<readonly Service[], RepositoryError>
>;

/** Live ACTIVE barbers of every shop, `orderBy sortOrder` (index #4). */
export type ObserveBarbers = () => Observable<
  Result<readonly Barber[], RepositoryError>
>;

/** Live service categories, `orderBy sortOrder` (no status is stored). */
export type ObserveCategories = () => Observable<
  Result<readonly ServiceCategory[], RepositoryError>
>;

/** Live ACTIVE shops, the active status, `orderBy sortOrder` (index #5). */
export type ObserveLocations = () => Observable<
  Result<readonly ShopLocation[], RepositoryError>
>;

/**
 * What a request reads of the catalogue before deciding: the named
 * services, positions preserved (`services[i]` is `serviceIds[i]`, `null`
 * when absent — refused as an unknown service by the system, exactly as the
 * commit refuses it), and the named shop (`null` when none was named or it
 * is gone).
 */
export type CatalogSnapshot = {
  readonly services: readonly (Service | null)[];
  readonly location: ShopLocation | null;
};

/**
 * `loadCatalog` (§4.1 `requestWaitlist`) — one `getAll` of the cart's
 * services and one read of the named shop (`loadCartServices` /
 * `loadNamedShop`, `request-waitlist.ts:130-170`). The read bound
 * (`MAX_SERVICES_PER_PERSON`) is checked by the system BEFORE this runs.
 */
export type LoadCatalog = (
  serviceIds: readonly ServiceId[],
  locationId: LocationId | null,
) => Promise<Result<CatalogSnapshot, RepositoryError>>;

/**
 * The listed catalogue a freed day is searched with — every ACTIVE service,
 * shop and barber (three single-field `== 'ACTIVE'` queries, bodies straight
 * from `snap.data()`).
 */
export type ListedCatalog = {
  readonly services: readonly Service[];
  readonly locations: readonly ShopLocation[];
  readonly barbers: readonly Barber[];
};
export type LoadListedCatalog = () => Promise<
  Result<ListedCatalog, RepositoryError>
>;

/** `locations/{id}`, once — `null` when absent (an event save's zone, F-4). */
export type LoadLocation = (
  id: LocationId,
) => Promise<Result<ShopLocation | null, RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The catalogue's four live streams — the bundle the web's `CATALOG_PORTS` token binds. */
export type CatalogReadPorts = {
  readonly observeServices: ObserveServices;
  readonly observeBarbers: ObserveBarbers;
  readonly observeCategories: ObserveCategories;
  readonly observeLocations: ObserveLocations;
};

/** The cart's services and named shop in one read — the functions' `firestore-catalog.adapter.ts`. */
export type CatalogLoadPorts = {
  readonly loadCatalog: LoadCatalog;
};

/** Every listed service, shop and barber — the waitlist matcher's day read. */
export type ListedCatalogPorts = {
  readonly loadListedCatalog: LoadListedCatalog;
};

/** One shop by id — `LOCATION_LOAD_PORTS` (an event save's zone, F-4). */
export type LocationLoadPorts = {
  readonly loadLocation: LoadLocation;
};

/**
 * The deployment's main shop — configuration, not a read (F-4): a boundary
 * with no location in scope places its wall clock on this shop's zone.
 * `DEFAULT_LOCATION_PORTS`, bound from `TenantConfig.DEFAULT`.
 */
export type DefaultLocationPorts = {
  readonly defaultLocationId: LocationId;
};

/** The catalogue context's whole port suite — an intersection of its bundles. */
export type CatalogPorts = CatalogReadPorts &
  CatalogLoadPorts &
  ListedCatalogPorts;
