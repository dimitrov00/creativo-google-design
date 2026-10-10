import {
  BarberOffering,
  type VariantTerms,
} from '../components/barber-offering.data';
import type { Money } from '../components/money.data';
import {
  ServiceTerms,
  type ServiceVariantId,
} from '../components/service-terms.data';
import type { BarberId } from '../entities/barber.entity';
import type { ServiceEntity } from '../entities/service.entity';

/** What the terms matrix reads of a service — a whole `ServiceEntity` passes in. */
export type PricedService = Pick<ServiceEntity, 'baseTerms' | 'offerings'>;

/** A closed `[min, max]` of minor units or minutes. */
export type OfferingRange = { readonly min: number; readonly max: number };

/**
 * OfferingPriceSystem — the service terms matrix (`service.ts:360-412`): which
 * `ServiceTerms` a booking of (service, barber, variant) is charged at, who
 * performs it, and the range the whole matrix spans. The one resolution the
 * server's commit, the bag, the review and the catalogue all read, so a
 * summary can never quote a price the server will not charge.
 */
export const OfferingPriceSystem = {
  /** This barber's offering, or `null` when they do not perform the service. */
  offeringFor(
    service: PricedService,
    barberId: BarberId,
  ): BarberOffering | null {
    for (let i = 0; i < service.offerings.length; i++) {
      const offering = service.offerings[i] as BarberOffering;
      if (offering.barberId === barberId) return offering;
    }
    return null;
  },

  /**
   * The one `ServiceTerms` that applies. Falls back down the axes it cannot
   * resolve: no barber (or one who does not perform it) yields `baseTerms`,
   * and a barber who does not price the variant differently yields their
   * own base. There is always an answer.
   */
  termsFor(
    service: PricedService,
    barberId: BarberId | null,
    variantId: ServiceVariantId | null,
  ): ServiceTerms {
    if (barberId === null) return service.baseTerms;
    const offering = OfferingPriceSystem.offeringFor(service, barberId);
    return offering === null
      ? service.baseTerms
      : BarberOffering.termsFor(offering, variantId);
  },

  /** The price of {@link termsFor} as `Money` — what the review and the bag quote. */
  price(
    service: PricedService,
    barberId: BarberId | null,
    variantId: ServiceVariantId | null,
  ): Money {
    return ServiceTerms.price(
      OfferingPriceSystem.termsFor(service, barberId, variantId),
    );
  },

  /** Who performs the service, in declaration order. */
  performerIds(service: PricedService): readonly BarberId[] {
    const ids: BarberId[] = [];
    for (let i = 0; i < service.offerings.length; i++) {
      ids.push((service.offerings[i] as BarberOffering).barberId);
    }
    return ids;
  },

  isPerformedBy(service: PricedService, barberId: BarberId): boolean {
    return OfferingPriceSystem.offeringFor(service, barberId) !== null;
  },

  /** Every terms a booking could land on — base, then each offering's base and overrides. */
  everyTerms(service: PricedService): readonly ServiceTerms[] {
    const all: ServiceTerms[] = [service.baseTerms];
    for (let i = 0; i < service.offerings.length; i++) {
      const offering = service.offerings[i] as BarberOffering;
      all.push(offering.base);
      for (let k = 0; k < offering.overrides.length; k++) {
        all.push((offering.overrides[k] as VariantTerms).terms);
      }
    }
    return all;
  },

  /**
   * Cheapest and dearest the service can be, in minor units — the matrix is
   * single-currency (an invariant of the service), so minor units compare
   * directly.
   */
  priceRange(service: PricedService): OfferingRange {
    const all = OfferingPriceSystem.everyTerms(service);
    let min = service.baseTerms.priceMinorUnits;
    let max = min;
    for (let i = 1; i < all.length; i++) {
      const price = (all[i] as ServiceTerms).priceMinorUnits;
      if (price < min) min = price;
      if (price > max) max = price;
    }
    return { min, max };
  },

  /** Shortest and longest sold duration across the whole matrix. */
  durationRange(service: PricedService): OfferingRange {
    const all = OfferingPriceSystem.everyTerms(service);
    let min = service.baseTerms.durationMinutes;
    let max = min;
    for (let i = 1; i < all.length; i++) {
      const minutes = (all[i] as ServiceTerms).durationMinutes;
      if (minutes < min) min = minutes;
      if (minutes > max) max = minutes;
    }
    return { min, max };
  },
} as const;
