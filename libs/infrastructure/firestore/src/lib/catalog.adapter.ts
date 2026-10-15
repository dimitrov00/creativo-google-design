import {
  type Firestore,
  type QueryConstraint,
  collection,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { BarberStatus, LocationStatus, ServiceStatus } from '@core/components';
import {
  type Barber,
  Collections,
  type Service,
  type ServiceCategory,
  type ShopLocation,
} from '@core/entities';
import type { CatalogReadPorts } from '@core/ports';
import { observeQuery } from './observe';

/**
 * The catalogue, live (flip 1, plan §3.4) — the successor of
 * `FirestoreCatalogReader`'s four streams. Public-read collections; each
 * query names root keys only and rides its declared index: services #1
 * (`categoryId`, `serviceStatus`, `sortOrder`) / #2 (`serviceStatus`,
 * `sortOrder`), barbers #3 (`locationIds` contains, `barberStatus`,
 * `sortOrder`) / #4 (`barberStatus`, `sortOrder`), locations #5
 * (`locationStatus`, `sortOrder`); categories carry no status and order by
 * `sortOrder` alone. Only what `/book` may list: an archived service, an
 * inactive barber and a hidden shop are filtered by the query itself.
 */
export const catalogReadPorts = (db: Firestore): CatalogReadPorts => {
  const ordered = (path: string, ...constraints: readonly QueryConstraint[]) =>
    query(collection(db, path), ...constraints, orderBy('sortOrder'));

  return {
    observeServices: (categoryId) =>
      observeQuery<Service>(
        ordered(
          Collections.Services,
          ...(categoryId === null
            ? []
            : [where('categoryId', '==', categoryId)]),
          where('serviceStatus', '==', ServiceStatus.Active),
        ),
        Collections.Services,
      ),

    observeBarbers: (locationId) =>
      observeQuery<Barber>(
        ordered(
          Collections.Barbers,
          ...(locationId === null
            ? []
            : [where('locationIds', 'array-contains', locationId)]),
          where('barberStatus', '==', BarberStatus.Active),
        ),
        Collections.Barbers,
      ),

    observeCategories: () =>
      observeQuery<ServiceCategory>(
        ordered(Collections.ServiceCategories),
        Collections.ServiceCategories,
      ),

    observeLocations: () =>
      observeQuery<ShopLocation>(
        ordered(
          Collections.Locations,
          where('locationStatus', '==', LocationStatus.Active),
        ),
        Collections.Locations,
      ),
  };
};
