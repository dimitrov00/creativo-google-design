import type { BarberOffering } from '@core/components';
import type { BarberId } from '@core/primitives';

/** What the listing reads of a service: who performs it. A whole `Service` passes. */
export type ListableService = {
  readonly offerings: readonly BarberOffering[];
};

/** What the listing reads of a barber record. A whole `Barber` passes. */
export type ListedBarber = {
  readonly id: BarberId;
};

/**
 * CatalogListingSystem — the catalogue as the public sees it (team
 * onboarding D3): a service's prices, «от» figures, «anyone» spans and
 * performer lists count only barbers who are LISTED (the public barber
 * list), never a draft's or a staff-only barber's offering.
 */
export const CatalogListingSystem = {
  /**
   * Every service as the public sees it, in the given order:
   *
   * - a service that lists no performer is everyone's, at its own terms —
   *   kept as it is;
   * - a service whose performers are all listed — kept as it is (the same
   *   object, no copy);
   * - a service some unlisted barber performs — a copy whose `offerings`
   *   keep the listed performers only;
   * - a service ONLY unlisted barbers perform — dropped: an empty
   *   `offerings` would read as "everyone performs it", which the commit
   *   would refuse.
   *
   * One pass over each service's handful of offerings; a `Set` of the
   * listed ids is built once per call.
   */
  listedServices<S extends ListableService>(
    services: readonly S[],
    listedBarbers: readonly ListedBarber[],
  ): readonly S[] {
    const listed = new Set<BarberId>();
    for (let i = 0; i < listedBarbers.length; i++) {
      listed.add((listedBarbers[i] as ListedBarber).id);
    }
    const out: S[] = [];
    for (let i = 0; i < services.length; i++) {
      const service = services[i] as S;
      const offerings = service.offerings;
      if (offerings.length === 0) {
        out.push(service);
        continue;
      }
      let kept: BarberOffering[] | null = null;
      for (let k = 0; k < offerings.length; k++) {
        const offering = offerings[k] as BarberOffering;
        if (listed.has(offering.barberId)) {
          kept?.push(offering);
        } else if (kept === null) {
          kept = offerings.slice(0, k) as BarberOffering[];
        }
      }
      if (kept === null) out.push(service);
      else if (kept.length > 0) out.push({ ...service, offerings: kept });
    }
    return out;
  },
} as const;
