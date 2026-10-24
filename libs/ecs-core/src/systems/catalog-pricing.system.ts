import {
  type BarberOffering,
  CompositionKind,
  type ServiceTerms,
  type ServiceVariant,
} from '@core/components';
import type { Service } from '@core/entities';
import {
  type DurationMinutes,
  type BarberId,
  MinuteCount,
  PriceCents,
  type ServiceVariantId,
} from '@core/primitives';
import {
  type OfferingRange,
  OfferingPriceSystem,
} from './offering-price.system';

/** What the catalogue views read of a service — a whole `Service` passes in. */
export type CatalogPriced = ServiceTerms &
  Pick<Service, 'variants' | 'offerings'>;

/** The card's price tag: the cheapest bookable price, and whether others cost more. */
export type CardPrice = {
  readonly cheapestCents: PriceCents;
  /** Some bookable terms cost more — the tag reads «от …» ("from"). */
  readonly spread: boolean;
};

/** One performer of a service and THEIR terms for the asked variant. */
export type PerformerTerms = {
  readonly barberId: BarberId;
  readonly terms: ServiceTerms;
};

/** What a bundle saves against booking its members one by one. */
export type BundleSaving = {
  readonly savedCents: PriceCents;
  readonly savedMinutes: MinuteCount;
};

/** One service a barber performs, at THEIR base terms (the offering's own). */
export type BarberServiceTerms<S> = {
  readonly service: S;
  readonly terms: ServiceTerms;
};

/**
 * Every terms a client can BOOK, offering by offering: each performer's
 * base, then their terms for each declared variant (an override, or their
 * base again). A service nobody performs yet quotes its own terms.
 */
function bookableTerms(service: CatalogPriced): readonly ServiceTerms[] {
  if (service.offerings.length === 0) return [service];
  const all: ServiceTerms[] = [];
  for (let i = 0; i < service.offerings.length; i++) {
    const offering = service.offerings[i] as BarberOffering;
    all.push(offering);
    for (let v = 0; v < service.variants.length; v++) {
      all.push(
        OfferingPriceSystem.termsFor(
          service,
          offering.barberId,
          (service.variants[v] as ServiceVariant).variantId,
        ),
      );
    }
  }
  return all;
}

/**
 * CatalogPricingSystem — the catalogue views' numbers
 * (`features/shared/catalog` `catalog.presenter.ts` `serviceToVm` — the view
 * model's `priceFrom`/`cardPrice`/`minutesRange` — and the landing's
 * `LandingContentService.barberPrices`): cents and minutes, never strings —
 * `formatCents` and the duration formatter are the presenter's.
 */
export const CatalogPricingSystem = {
  /** Cheapest BASE offering — the "from" price on a marketing tile. */
  priceFrom(service: CatalogPriced): PriceCents {
    if (service.offerings.length === 0) return service.priceCents;
    let cheapest = (service.offerings[0] as BarberOffering).priceCents;
    for (let i = 1; i < service.offerings.length; i++) {
      const price = (service.offerings[i] as BarberOffering).priceCents;
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
    let cheapest = (all[0] as ServiceTerms).priceCents;
    let dearest = cheapest;
    for (let i = 1; i < all.length; i++) {
      const price = (all[i] as ServiceTerms).priceCents;
      if (price < cheapest) cheapest = price;
      if (price > dearest) dearest = price;
    }
    return { cheapestCents: cheapest, spread: dearest > cheapest };
  },

  /** Shortest and longest bookable duration, across offerings × variants. */
  durationRange(service: CatalogPriced): OfferingRange<DurationMinutes> {
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
      if (offering !== null) out.push({ service, terms: offering });
    }
    return out;
  },

  /**
   * Who performs the service, each with THEIR terms for `variantId` (`null`
   * = the base) — cheapest first on the terms actually quoted, a STABLE sort
   * on `priceCents` (performers who charge the same keep declaration order).
   * The services step's barber select, the bag's named performers and the
   * service sheet's performer cards (`performerOptions`, `performerSelect`,
   * `performers`). Composes {@link OfferingPriceSystem.performerIds} and
   * {@link OfferingPriceSystem.termsFor}; `[]` when nobody performs it (the
   * service's own terms are never a performer's). Which performers are on
   * the active list is the caller's host lookup.
   */
  performersByPrice(
    service: CatalogPriced,
    variantId: ServiceVariantId | null,
  ): readonly PerformerTerms[] {
    const ids = OfferingPriceSystem.performerIds(service);
    const performers: PerformerTerms[] = [];
    for (let i = 0; i < ids.length; i++) {
      const barberId = ids[i] as BarberId;
      performers.push({
        barberId,
        terms: OfferingPriceSystem.termsFor(service, barberId, variantId),
      });
    }
    performers.sort((a, b) => a.terms.priceCents - b.terms.priceCents);
    return performers;
  },

  /**
   * What a BUNDLE saves against booking its members separately, in integer
   * cents (`service-detail-sheet.component.ts` `savings`, DEP-10: the sheet
   * summed float major units). Priced against the SAME barber the bundle's
   * "from" price comes from — its cheapest BASE offering, the first of
   * equals — since mixing barbers would compare a total nobody can book; a
   * bundle nobody performs yet is priced at its own terms against members
   * nobody performs either. `null` when the service is not a bundle, it has
   * no member, a member is not offered by that barber (or, for the
   * unperformed bundle, is performed by someone), or the bundle is not
   * cheaper — an unearned "you save" is worse than none. The minutes saved
   * never go below zero. Currencies are not compared (the catalogue is
   * single-currency); the members' cents are summed as they are.
   */
  bundleSaving(
    bundle: CatalogPriced & Pick<Service, 'compositionKind'>,
    members: readonly CatalogPriced[],
  ): BundleSaving | null {
    if (
      bundle.compositionKind !== CompositionKind.Bundle ||
      members.length === 0
    ) {
      return null;
    }
    let priced: ServiceTerms = bundle;
    let barberId: BarberId | null = null;
    if (bundle.offerings.length > 0) {
      let cheapest = bundle.offerings[0] as BarberOffering;
      for (let i = 1; i < bundle.offerings.length; i++) {
        const offering = bundle.offerings[i] as BarberOffering;
        if (offering.priceCents < cheapest.priceCents) cheapest = offering;
      }
      priced = cheapest;
      barberId = cheapest.barberId;
    }
    let separately = PriceCents.ZERO;
    let minutes = 0;
    for (let i = 0; i < members.length; i++) {
      const member = members[i] as CatalogPriced;
      const own: ServiceTerms | null =
        barberId === null
          ? member.offerings.length === 0
            ? member
            : null
          : OfferingPriceSystem.offeringFor(member, barberId);
      if (own === null) return null;
      separately = PriceCents.add(separately, own.priceCents);
      minutes += own.durationMinutes;
    }
    const savedCents = PriceCents.sub(separately, priced.priceCents);
    if (savedCents <= 0) return null;
    const savedMinutes = MinuteCount.of(
      Math.max(0, minutes - priced.durationMinutes),
    );
    return {
      savedCents,
      savedMinutes: savedMinutes.ok ? savedMinutes.value : MinuteCount.ZERO,
    };
  },
} as const;
