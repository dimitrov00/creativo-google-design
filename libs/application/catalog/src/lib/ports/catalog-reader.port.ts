import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import {
  Barber,
  BarberId,
  Location,
  LocationId,
  Service,
  ServiceCategory,
  ServiceCategoryId,
  ServiceId,
} from '@creativo/domain/catalog';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The web app's single read path over the catalog (there is no write path
 * in this pass — catalog content is authored/managed elsewhere). Lists are
 * `Observable` (blueprint §5.2, live-updating); point lookups are `Promise`.
 */
export interface CatalogReader {
  listActiveServices(
    categoryId?: ServiceCategoryId,
  ): Observable<Result<readonly Service[], RepositoryError>>;
  findServiceById(
    id: ServiceId,
  ): Promise<Result<Service | null, RepositoryError>>;
  listServiceCategories(): Observable<
    Result<readonly ServiceCategory[], RepositoryError>
  >;
  listActiveBarbers(
    locationId?: LocationId,
  ): Observable<Result<readonly Barber[], RepositoryError>>;
  findBarberById(id: BarberId): Promise<Result<Barber | null, RepositoryError>>;
  listActiveLocations(): Observable<
    Result<readonly Location[], RepositoryError>
  >;
  findLocationById(
    id: LocationId,
  ): Promise<Result<Location | null, RepositoryError>>;
}

export const CATALOG_READER = new InjectionToken<CatalogReader>(
  'CatalogReader',
);
