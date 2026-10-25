import type { DurationMinutes } from '@core/primitives';
import {
  type BarberOffering,
  CompositionKind,
  Money,
  ServiceComposition,
  type ServiceTerms,
} from '@core/components';
import { CatalogPricingSystem, type OfferingRange } from '@core/systems';
import type { Barber, Service } from '@core/entities';
import {
  type BarberVm,
  type Localized,
  type ServiceOfferingVm,
  type ServiceTermsVm,
  type ServiceVm,
  type ServiceVariantVm,
  VariantIcon,
} from './catalog.vm';

/**
 * Entity → view model, so the landing renders the REAL catalog while its
 * components keep binding the `ServiceVm`/`BarberVm` shapes they were
 * written against. The view models stay: what changed is their source.
 *
 * The catalog cannot answer everything a marketing page shows. Art
 * direction — a barber's selected-work gallery, their one-line craft
 * summary, the avatar focal point — is editorial copy with no business
 * meaning, so it stays hand-authored here, keyed by id, and is merged onto
 * whatever the catalog returns. `rating` is the one field that simply
 * disappears: `Barber` refuses to model it ("fabricated ratings read as a
 * scam"), and inventing one at the presentation layer would be the same
 * lie one layer up.
 */

/** Editorial extras the catalog has no business carrying, keyed by barber id. */
export interface BarberArtDirection {
  readonly specialty: Localized;
  readonly gallery: readonly string[];
  readonly objectPosition: string;
}

/** Editorial extras keyed by service id. */
export interface ServiceArtDirection {
  readonly gallery: readonly string[];
}

const DEFAULT_OBJECT_POSITION = '50% 25%';

function localized(text: { en: string; bg: string }): Localized {
  return { en: text.en, bg: text.bg };
}

/**
 * The flat terms → the VM's terms: the cents beside their currency and the
 * sold minutes, as stored — an offering's base, a variant's terms, or a
 * barber's terms for a service (the landing's
 * `LandingContentService.barberPrices`).
 */
export function termsToVm(terms: ServiceTerms): ServiceTermsVm {
  return {
    priceCents: terms.priceCents,
    currency: terms.currency,
    minutes: terms.durationMinutes,
  };
}

/** A terms quote's price, as the money `CatalogWording.price` words. */
export function termsPrice(terms: ServiceTermsVm): Money {
  return Money.fromCents(terms.priceCents, terms.currency);
}

/**
 * An offering → its VM: the barber and the base terms the service sheet
 * reads. No per-variant map: every variant figure a surface prints is
 * `CatalogPricingSystem`'s answer on the entity (pass C wave 2 — the map had
 * no reader).
 */
function offeringToVm(offering: BarberOffering): ServiceOfferingVm {
  return {
    barberId: offering.barberId,
    // The offering's own five root fields ARE its base terms (the slice).
    base: termsToVm(offering),
  };
}

export function serviceToVm(
  service: Service,
  coverSrc: string | undefined,
  art: ServiceArtDirection | undefined,
): ServiceVm {
  const variants: ServiceVariantVm[] = service.variants.map((variant) => ({
    id: variant.variantId,
    name: localized(variant.name),
    // The icon is a rendering choice, not catalog data; length is the only
    // axis the seed declares, and `skin` was never wired to anything.
    icon: VariantIcon.Length,
  }));

  const offerings = service.offerings.map(offeringToVm);

  // An unspecified composition (`composition: null` as authored) draws as a
  // single service — the companion's rule, never re-spelled here.
  const compositionKind = ServiceComposition.drawnKind(service.compositionKind);
  // The catalogue's figures are asked ONCE of the system, on the entity
  // itself (below), and carried as the system answered them.
  return {
    id: service.id,
    compositionKind,
    name: localized(service.name),
    description: localized(service.description),
    ...(coverSrc ? { coverSrc } : {}),
    variants,
    // Who performs it, at their base terms — `[]` when nobody does yet. The
    // service detail sheet asks `CatalogPricingSystem` on the entity for its
    // performers and its bundle saving (pass C, C-4/C-6), so no surface
    // needs an anonymous stand-in offering any more.
    offerings,
    ...(compositionKind === CompositionKind.Bundle
      ? { includes: [...ServiceComposition.parts(service)] }
      : {}),
    upsellOnly: service.upsellOnly,
    gallery: art?.gallery ?? [],
    currency: service.currency,
    priceFromCents: CatalogPricingSystem.priceFrom(service),
    cardPrice: CatalogPricingSystem.cardPrice(service),
    minutesRange: CatalogPricingSystem.durationRange(service),
  };
}

export function barberToVm(
  barber: Barber,
  avatarSrc: string | undefined,
  art: BarberArtDirection | undefined,
): BarberVm {
  return {
    id: barber.id,
    name: localized(barber.name),
    title: localized(barber.title),
    bio: localized(barber.bio),
    avatarSrc: avatarSrc ?? '',
    objectPosition: art?.objectPosition ?? DEFAULT_OBJECT_POSITION,
    // No `rating` — see the note at the top of this file.
    specialty: art?.specialty ?? localized(barber.title),
    gallery: art?.gallery ?? [],
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────
//
// Neither money nor minutes are formatted here. A price is `formatCents`
// (`@creativo/ui/wall-clock`, the ONE money formatter — the currency's own
// fraction digits, so «28,00 €» lines up beside «17,50 €» in a tabular
// column), reached through `CatalogWording.price`; a duration range is
// `formatMinutesRange` (the same lib, cached per locale — pass E, E-12),
// reached through `CatalogWording.durationRange`.

/**
 * Cheapest base offering — the "from" price on a marketing tile: the
 * `CatalogPricingSystem.priceFrom` answer the view model carries, in the
 * service's stored currency.
 */
export function servicePriceFrom(service: ServiceVm): Money {
  return Money.fromCents(service.priceFromCents, service.currency);
}

/**
 * The card's price tag — `CatalogPricingSystem.cardPrice`'s cheapest
 * bookable terms the view model carries, in the service's stored currency.
 */
export function serviceCardPrice(service: ServiceVm): Money {
  return Money.fromCents(service.cardPrice.cheapestCents, service.currency);
}

/**
 * The service card's second line: `от 13,00 €`, or `30 – 45 мин · от 13,00 €`
 * where the caller still wants the duration on it.
 *
 * ONE definition, because there were three. Onboarding built this string
 * inline, the landing tile built a shorter one, and booking built a third
 * that had quietly lost the "from" — so the same catalog read as a
 * different product depending on which screen you were on.
 *
 * `fromLabel` is passed rather than translated here: this module is pure
 * (no DI, no transloco), and every caller already holds a `t`.
 *
 * The prefix is CONDITIONAL. When every performer charges the same there is
 * nothing to be "from" — a permanent "from" on a fixed price is a hedge the
 * price does not need.
 */
export function formatServiceMeta(parts: {
  /** Omitted where the card is a price tag and the sheet states the time. */
  readonly duration?: string;
  readonly price: string;
  readonly fromLabel: string;
  readonly spread: boolean;
}): string {
  const price = parts.spread
    ? `${parts.fromLabel} ${parts.price}`
    : parts.price;
  return parts.duration ? `${parts.duration} · ${price}` : price;
}

/**
 * Global duration range across offerings × variants: the
 * `CatalogPricingSystem.durationRange` answer the view model carries.
 */
export function serviceDurationRange(
  service: ServiceVm,
): OfferingRange<DurationMinutes> {
  return service.minutesRange;
}
