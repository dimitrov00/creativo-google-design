import { BarberOffering, type Money, ServiceTerms } from '@core/components';
import type { Service } from '@core/entities';
import type {
  DurationMinutes,
  BarberId,
  ServiceVariantId,
  PriceCents,
} from '@core/primitives';

/**
 * What the terms matrix reads of a service — its own `ServiceTerms` fields
 * (the catalogue terms, at the root) and its offerings. A whole `Service`
 * passes straight in (Law 3: zero inbound mapping).
 */
export type PricedService = ServiceTerms & Pick<Service, 'offerings'>;

/** A closed `[min, max]` of cents or minutes. */
export type OfferingRange<T extends number = number> = {
  readonly min: T;
  readonly max: T;
};

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
   * resolve: no barber (or one who does not perform it) yields the service's
   * own terms, and a barber who does not price the variant differently
   * yields their own base. There is always an answer — a struct the caller
   * already holds, never a copy.
   */
  termsFor(
    service: PricedService,
    barberId: BarberId | null,
    variantId: ServiceVariantId | null,
  ): ServiceTerms {
    if (barberId === null) return service;
    const offering = OfferingPriceSystem.offeringFor(service, barberId);
    return offering === null
      ? service
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

  /** Every terms a booking could land on — the service's, then each offering's base and overrides. */
  everyTerms(service: PricedService): readonly ServiceTerms[] {
    const all: ServiceTerms[] = [service];
    for (let i = 0; i < service.offerings.length; i++) {
      const offering = service.offerings[i] as BarberOffering;
      const own = BarberOffering.allTerms(offering);
      for (let k = 0; k < own.length; k++) all.push(own[k] as ServiceTerms);
    }
    return all;
  },

  /**
   * Cheapest and dearest the service can be, in cents — the matrix is
   * single-currency (an invariant of the service), so cents compare
   * directly.
   */
  priceRange(service: PricedService): OfferingRange<PriceCents> {
    const all = OfferingPriceSystem.everyTerms(service);
    let min = service.priceCents;
    let max = min;
    for (let i = 1; i < all.length; i++) {
      const price = (all[i] as ServiceTerms).priceCents;
      if (price < min) min = price;
      if (price > max) max = price;
    }
    return { min, max };
  },

  /** Shortest and longest sold duration across the whole matrix. */
  durationRange(service: PricedService): OfferingRange<DurationMinutes> {
    const all = OfferingPriceSystem.everyTerms(service);
    let min = service.durationMinutes;
    let max = min;
    for (let i = 1; i < all.length; i++) {
      const minutes = (all[i] as ServiceTerms).durationMinutes;
      if (minutes < min) min = minutes;
      if (minutes > max) max = minutes;
    }
    return { min, max };
  },
} as const;
