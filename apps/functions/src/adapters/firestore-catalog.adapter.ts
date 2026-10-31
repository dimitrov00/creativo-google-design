import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { LocationId, Result, ServiceId } from '@core/primitives';
import { BarberStatus, LocationStatus, ServiceStatus } from '@core/components';
import {
  type Barber,
  Collections,
  type Service,
  type ShopLocation,
} from '@core/entities';
import type {
  CatalogLoadPorts,
  ListedCatalogPorts,
  LocationLoadPorts,
} from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The catalogue's server reads (flip 1, blueprint §4.1) — bodies spread as
 * stored (`{ id, ...snap.data() }`, the entity), no mapping, no decision:
 *
 * - `loadCatalog` — the waitlist door's read: the named services by id in
 *   ONE `getAll` (positions preserved, `null` when absent) and the named shop.
 *   An id that could not name a document (blank, a `/`, `.`/`..`, a reserved
 *   `__…__` — the id primitive's own `is`, OR-44) is never read — the SDK
 *   would throw on the path — and answers `null`, which the system refuses
 *   like any absent row.
 * - `loadListedCatalog` — the waitlist matcher's day read: every ACTIVE
 *   service, shop and barber (three single-field `== 'ACTIVE'` queries on
 *   the root status keys, no composite).
 * - `loadLocation` — one shop by id, `null` when absent: where every server
 *   pipeline reads its wall clock's zone (`resolveShopZone`, Phase 4a
 *   4A-11 — the named shop, else the default location).
 *
 * A read that throws answers a `RepositoryError` value whose `reason` is the
 * failure's canonical code (`unavailable`, `aborted`, …) — codes only, and
 * what the retrying edge judges a redelivery by.
 */

/** The entity a snapshot holds — the body is the entity minus `id`. */
function entityOf<E>(snap: DocumentSnapshot): E | null {
  return snap.exists ? ({ id: snap.id, ...snap.data() } as E) : null;
}

/** Every document of `collection` whose root `field` is `ACTIVE`. */
async function active<E>(
  db: Firestore,
  collection: string,
  field: string,
  value: string,
): Promise<readonly E[]> {
  const snap = await db.collection(collection).where(field, '==', value).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as E);
}

export const firestoreCatalogPorts = (
  db: Firestore,
): CatalogLoadPorts & ListedCatalogPorts & LocationLoadPorts => ({
  loadCatalog: async (serviceIds, locationId) => {
    try {
      const readable = serviceIds.filter((id) => ServiceId.is(id));
      const [serviceSnaps, locationSnap] = await Promise.all([
        readable.length === 0
          ? Promise.resolve([])
          : db.getAll(
              ...readable.map((id) =>
                db.collection(Collections.Services).doc(id),
              ),
            ),
        locationId === null || !LocationId.is(locationId)
          ? Promise.resolve(null)
          : db.collection(Collections.Locations).doc(locationId).get(),
      ]);
      const byId = new Map<string, Service>();
      for (const snap of serviceSnaps) {
        const service = entityOf<Service>(snap);
        if (service !== null) byId.set(snap.id, service);
      }
      return Result.ok({
        services: serviceIds.map((id) => byId.get(id) ?? null),
        location:
          locationSnap === null ? null : entityOf<ShopLocation>(locationSnap),
      });
    } catch (error) {
      return Result.err(readFailed(Collections.Services, error));
    }
  },

  loadListedCatalog: async () => {
    try {
      const [services, locations, barbers] = await Promise.all([
        active<Service>(
          db,
          Collections.Services,
          'serviceStatus',
          ServiceStatus.Active,
        ),
        active<ShopLocation>(
          db,
          Collections.Locations,
          'locationStatus',
          LocationStatus.Active,
        ),
        active<Barber>(
          db,
          Collections.Barbers,
          'barberStatus',
          BarberStatus.Active,
        ),
      ]);
      return Result.ok({ services, locations, barbers });
    } catch (error) {
      return Result.err(readFailed(Collections.Services, error));
    }
  },

  loadLocation: async (id) => {
    const path = `${Collections.Locations}/${id}`;
    if (!LocationId.is(id)) return Result.ok(null);
    try {
      const snap = await db.collection(Collections.Locations).doc(id).get();
      return Result.ok(entityOf<ShopLocation>(snap));
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
  },
});
