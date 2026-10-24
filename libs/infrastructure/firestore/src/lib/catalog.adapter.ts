import {
  type Firestore,
  type QueryConstraint,
  collection,
  doc,
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
import type { CatalogReadPorts, LocationLoadPorts } from '@core/ports';
import { observeQuery, readDoc } from './observe';

/**
 * The catalogue, live (flip 1, plan §3.4) — the successor of
 * `FirestoreCatalogReader`'s four streams. Public-read collections; each
 * query names root keys only and rides its declared index: services #2
 * (`serviceStatus`, `sortOrder`), barbers #4 (`barberStatus`, `sortOrder`),
 * locations #5 (`locationStatus`, `sortOrder`); categories carry no status
 * and order by `sortOrder` alone. Only what `/book` may list: an archived
 * service, an inactive barber and a hidden shop are filtered by the query
 * itself, and every stream lists the whole active catalogue.
 */
export const catalogReadPorts = (db: Firestore): CatalogReadPorts => {
  const ordered = (path: string, ...constraints: readonly QueryConstraint[]) =>
    query(collection(db, path), ...constraints, orderBy('sortOrder'));

  return {
    observeServices: () =>
      observeQuery<Service>(
        ordered(
          Collections.Services,
          where('serviceStatus', '==', ServiceStatus.Active),
        ),
        Collections.Services,
      ),

    observeBarbers: () =>
      observeQuery<Barber>(
        ordered(
          Collections.Barbers,
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

/**
 * One shop by id, once — `null` when there is no such document (flip 4,
 * plan §3.7): the shop an event save reads its zone from (F-4), whatever
 * its `locationStatus` (a hidden shop still has a clock). The body as
 * stored, beside its id.
 */
export const locationLoadPorts = (db: Firestore): LocationLoadPorts => ({
  loadLocation: (id) =>
    readDoc<ShopLocation>(doc(db, Collections.Locations, id)),
});
