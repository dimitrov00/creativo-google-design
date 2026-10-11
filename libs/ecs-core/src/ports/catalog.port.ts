import type { Observable } from 'rxjs';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { Barber } from '../entities/barber.entity';
import type { ServiceCategory } from '../entities/service-category.entity';
import type { Service } from '../entities/service.entity';
import type { ShopLocation } from '../entities/shop-location.entity';
import type {
  LocationId,
  ServiceCategoryId,
  ServiceId,
} from '../primitives/ids.primitive';

/**
 * The catalogue's read ports (blueprint §4.2) — one function per query
 * shape, the entities straight from `snap.data()` (no mapper), every one
 * naming its error: `Result<X, RepositoryError>`. Successor of the
 * application layer's `CatalogReader` (`catalog-reader.port.ts`, the
 * queries of `catalog-reader.adapter.ts:252-367` on indexes #1-#5) and the
 * functions' own catalogue reads (`request-waitlist.ts:130-170`).
 */

/**
 * Live ACTIVE services, `orderBy sortOrder` — the active status, plus
 * `categoryId ==` when a category is given. `null` lists every category.
 */
export type ObserveServices = (
  categoryId: ServiceCategoryId | null,
) => Observable<Result<readonly Service[], RepositoryError>>;

/**
 * Live ACTIVE barbers, `orderBy sortOrder` — the active status, plus
 * `locationIds array-contains` when a shop is given. `null` lists every
 * shop's barbers.
 */
export type ObserveBarbers = (
  locationId: LocationId | null,
) => Observable<Result<readonly Barber[], RepositoryError>>;

/** Live service categories, `orderBy sortOrder` (no status is stored). */
export type ObserveCategories = () => Observable<
  Result<readonly ServiceCategory[], RepositoryError>
>;

/** Live ACTIVE shops, the active status, `orderBy sortOrder`. */
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
 * The catalogue context's port catalogue. Each composition root binds the
 * `Pick` its runtime implements: the web the four live streams, the
 * functions `loadCatalog`.
 */
export type CatalogPorts = {
  readonly observeServices: ObserveServices;
  readonly observeBarbers: ObserveBarbers;
  readonly observeCategories: ObserveCategories;
  readonly observeLocations: ObserveLocations;
  readonly loadCatalog: LoadCatalog;
};
