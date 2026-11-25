import type { LocalizedText } from '@core/components';
import type {
  BarberId,
  LocationId,
  ServiceId,
  TimeZone,
} from '@core/primitives';
import type { VisitLookup } from './visit-lookup.contracts';

/**
 * What a client page holds of the live catalogue — the entities and view
 * models as the catalogue services hand them over (`CatalogContentService`,
 * `TeamCatalogService`), read through plain values so this file needs no
 * catalogue service of its own.
 */
export interface VisitCatalogue {
  /** A service as STORED, every performer included (`findAnyService`). */
  findService(id: ServiceId): { readonly name: LocalizedText } | undefined;
  /** Every barber the viewer can name, a past visit's included (`namedBarberVms`). */
  readonly barbers: readonly {
    readonly id: BarberId;
    readonly name: LocalizedText;
    readonly avatarSrc: string | null;
  }[];
  /** The active shops. */
  readonly locations: readonly {
    readonly id: LocationId;
    readonly name: LocalizedText;
    readonly timeZone: TimeZone;
  }[];
  /** A localized pair in the active language (`CatalogWording.text`). */
  text(localized: LocalizedText): string;
}

/**
 * THE CLIENT'S CATALOGUE LOOKUP — names in the active language, the
 * barber's face, the shop and its zone — the one a client's visit list
 * (`/account/appointments`) and the client's home (`/account`) hand the
 * row and card builders. A barber is found by id in one pass over the
 * list; a shop by a scan of the handful there are.
 */
export function visitLookupOf(catalogue: VisitCatalogue): VisitLookup {
  const barbers = new Map(
    catalogue.barbers.map((barber) => [barber.id, barber]),
  );
  const locations = catalogue.locations;
  const shopOf = (id: LocationId) =>
    locations.find((location) => location.id === id);
  return {
    serviceName: (id) => {
      const service = catalogue.findService(id);
      return service ? catalogue.text(service.name) : null;
    },
    barberName: (id) => {
      const barber = barbers.get(id);
      return barber ? catalogue.text(barber.name) : null;
    },
    barberAvatarSrc: (id) => barbers.get(id)?.avatarSrc ?? null,
    locationName: (id) => {
      const shop = shopOf(id);
      return shop ? catalogue.text(shop.name) : null;
    },
    locationCount: locations.length,
    locationTimeZone: (id) => shopOf(id)?.timeZone ?? null,
  };
}
