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
import { Result } from '@core/primitives';
import { HttpsStatus } from '@core/errors';
import {
  type Barber,
  Collections,
  type Service,
  type ServiceCategory,
  type ShopLocation,
} from '@core/entities';
import type {
  BarberLookupPorts,
  CatalogReadPorts,
  LocationLoadPorts,
  TeamBarberReadPorts,
} from '@core/ports';
import { observeQuery, readDoc } from './observe';

/**
 * The catalogue, live (flip 1, plan §3.4) — the successor of
 * `FirestoreCatalogReader`'s four streams. Public-read collections; each
 * query names root keys only and rides its declared index: services #2
 * (`serviceStatus`, `sortOrder`), barbers #4 (`barberStatus`, `sortOrder`),
 * locations #5 (`locationStatus`, `sortOrder`); categories carry no status
 * and order by `sortOrder` alone. Only what `/book` may list: an archived
 * service, an inactive barber and a hidden shop are filtered by the query
 * itself (a barber is listed only while `PUBLIC` — a draft, a staff-only
 * and a departed barber are not), and every stream lists the whole active
 * catalogue.
 */
export const catalogReadPorts = (db: Firestore): CatalogReadPorts => {
  const ordered = (path: string, ...constraints: readonly QueryConstraint[]) =>
    // unbounded-ok: the shop's own catalogue, which staff write by hand
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
          where('barberStatus', '==', BarberStatus.Public),
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
 * The whole team, live (team onboarding D3) — every barber record by
 * `sortOrder` (the field's automatic single-field index), whatever its
 * status. Staff only: the read rule lets staff read a `DRAFT`.
 */
export const teamBarberReadPorts = (db: Firestore): TeamBarberReadPorts => ({
  observeTeamBarbers: () =>
    observeQuery<Barber>(
      // unbounded-ok: the shop's own staff, a handful to a few dozen
      query(collection(db, Collections.Barbers), orderBy('sortOrder')),
      Collections.Barbers,
    ),
});

/**
 * Barber records by id — single gets, so the read rule judges each record
 * on its own (a client may read any barber but a `DRAFT`). An id with no
 * record, or one the reader may not read, is left out; any other failure
 * answers the first one.
 */
export const barberLookupPorts = (db: Firestore): BarberLookupPorts => ({
  loadBarbers: async (ids) => {
    const answers = await Promise.all(
      ids.map((id) => readDoc<Barber>(doc(db, Collections.Barbers, id))),
    );
    const barbers: Barber[] = [];
    for (const answer of answers) {
      if (answer.ok) {
        if (answer.value !== null) barbers.push(answer.value);
      } else if (answer.error.reason !== HttpsStatus.PermissionDenied) {
        return answer;
      }
    }
    return Result.ok(barbers);
  },
});

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
