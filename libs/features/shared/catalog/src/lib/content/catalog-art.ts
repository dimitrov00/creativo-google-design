import { InjectionToken } from '@angular/core';
import type {
  BarberArtDirection,
  ServiceArtDirection,
} from './catalog.presenter';

/**
 * Art direction — the editorial extras the catalog has no business carrying.
 *
 * A barber's selected-work gallery, their one-line craft summary, an avatar's
 * focal point: none of it has business meaning, none of it belongs in
 * Firestore, and all of it is keyed by id and merged onto whatever the catalog
 * returns.
 *
 * It lives HERE, in the shared catalog lib, because every surface that renders
 * a service or a barber needs it — the landing, onboarding, AND `/book`. It
 * used to live in `features/marketing/landing`, which booking cannot import,
 * so booking rendered the shared detail sheet with an empty gallery and the
 * media section silently vanished. The sheet was reused; the data it needed
 * was not, and the drift showed up as a missing section rather than an error.
 *
 * Keyed by the STORED ids, so an entry exists only for a barber or a service
 * the catalogue really holds, and only with pictures of the shop's own work.
 * Production holds none yet (2026-11-19): the entries it carried were keyed
 * by the demo barbers and the dev seed's services, and their galleries were
 * bundled photos that are not the shop's work (owner, 2026-11-19). The demo
 * art the specs render is test support
 * (`libs/features/marketing/landing/src/testing`), provided through
 * {@link CATALOG_ART}.
 */
export interface CatalogArt {
  readonly barbers: Readonly<Record<string, BarberArtDirection>>;
  readonly services: Readonly<Record<string, ServiceArtDirection>>;
}

/** No art: every barber and service renders from the catalogue alone. */
export const NO_CATALOG_ART: CatalogArt = { barbers: {}, services: {} };

/**
 * The art `CatalogContentService` merges onto the catalogue — today
 * {@link NO_CATALOG_ART}; a spec provides its demo art here.
 */
export const CATALOG_ART = new InjectionToken<CatalogArt>('CATALOG_ART', {
  providedIn: 'root',
  factory: () => NO_CATALOG_ART,
});
