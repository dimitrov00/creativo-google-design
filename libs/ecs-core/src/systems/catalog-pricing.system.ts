import type { BarberOffering } from '../components/barber-offering.data';
import type {
  ServiceTerms,
  ServiceVariant,
} from '../components/service-terms.data';
import type { BarberId } from '../entities/barber.entity';
import type { ServiceEntity } from '../entities/service.entity';
import {
  type OfferingRange,
  OfferingPriceSystem,
} from './offering-price.system';

/** What the catalogue views read of a service — a whole `ServiceEntity` passes in. */
export type CatalogPriced = Pick<
  ServiceEntity,
  'baseTerms' | 'variants' | 'offerings'
>;

/** The card's price tag: the cheapest bookable price, and whether others cost more. */
export type CardPrice = {
  readonly cheapestMinorUnits: number;
  /** Some bookable terms cost more — the tag reads «от …» ("from"). */
  readonly spread: boolean;
};

/** One service a barber performs, at THEIR base terms. */
export type BarberServiceTerms<S> = {
  readonly service: S;
  readonly terms: ServiceTerms;
};

/**
 * Every terms a client can BOOK, offering by offering: each performer's
 * base, then their terms for each declared variant (an override, or their
 * base again). A service nobody performs yet quotes its `baseTerms`.
 */
function bookableTerms(service: CatalogPriced): readonly ServiceTerms[] {
  if (service.offerings.length === 0) return [service.baseTerms];
  const all: ServiceTerms[] = [];
  for (let i = 0; i < service.offerings.length; i++) {
    const offering = service.offerings[i] as BarberOffering;
    all.push(offering.base);
    for (let v = 0; v < service.variants.length; v++) {
      all.push(
        OfferingPriceSystem.termsFor(
          service,
          offering.barberId,
          (service.variants[v] as ServiceVariant).id,
        ),
      );
    }
  }
  return all;
}

/**
 * CatalogPricingSystem — the catalogue views' numbers
 * (`features/shared/catalog` `catalog-vm.ts` `servicePriceFrom`/
 * `serviceDurationRange`/`servicesByBarber`, `catalog-presenter.service.ts`
 * `serviceMeta`): minor units and minutes, never strings — `formatMoney` and
 * the duration formatter are the template's.
 */
export const CatalogPricingSystem = {
  /** Cheapest BASE offering — the "from" price on a marketing tile. */
  priceFrom(service: CatalogPriced): number {
    if (service.offerings.length === 0) {
      return service.baseTerms.priceMinorUnits;
    }
    let cheapest = (service.offerings[0] as BarberOffering).base
      .priceMinorUnits;
    for (let i = 1; i < service.offerings.length; i++) {
      const price = (service.offerings[i] as BarberOffering).base
        .priceMinorUnits;
      if (price < cheapest) cheapest = price;
    }
    return cheapest;
  },

  /**
   * The card's tag over EVERY bookable terms, not just the base ones — a
   * card that folded only the bases quoted a cheapest price the sheet it
   * opens could contradict one tap later. `spread` is false when every
   * performer charges the same: a permanent "from" on a fixed price is a
   * hedge the price does not need.
   */
  cardPrice(service: CatalogPriced): CardPrice {
    const all = bookableTerms(service);
    let cheapest = (all[0] as ServiceTerms).priceMinorUnits;
    let dearest = cheapest;
    for (let i = 1; i < all.length; i++) {
      const price = (all[i] as ServiceTerms).priceMinorUnits;
      if (price < cheapest) cheapest = price;
      if (price > dearest) dearest = price;
    }
    return { cheapestMinorUnits: cheapest, spread: dearest > cheapest };
  },

  /** Shortest and longest bookable duration, across offerings × variants. */
  durationRange(service: CatalogPriced): OfferingRange {
    const all = bookableTerms(service);
    let min = (all[0] as ServiceTerms).durationMinutes;
    let max = min;
    for (let i = 1; i < all.length; i++) {
      const minutes = (all[i] as ServiceTerms).durationMinutes;
      if (minutes < min) min = minutes;
      if (minutes > max) max = minutes;
    }
    return { min, max };
  },

  /**
   * Every service a barber performs, with THEIR base terms for it — the
   * inverse of `offerings`, the only direction the catalogue stores. The
   * caller passes the set (the marketing shelf hands in the shelf, so
   * upsell-only add-ons stay out of it); each service is returned as given.
   */
  servicesByBarber<S extends CatalogPriced>(
    services: readonly S[],
    barberId: BarberId,
  ): readonly BarberServiceTerms<S>[] {
    const out: BarberServiceTerms<S>[] = [];
    for (let i = 0; i < services.length; i++) {
      const service = services[i] as S;
      const offering = OfferingPriceSystem.offeringFor(service, barberId);
      if (offering !== null) out.push({ service, terms: offering.base });
    }
    return out;
  },
} as const;
