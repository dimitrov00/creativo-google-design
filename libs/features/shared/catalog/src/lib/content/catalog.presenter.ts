import type { PriceCents } from '@core/primitives';
import {
  type BarberOffering,
  CompositionKind,
  ServiceComposition,
  type ServiceTerms,
} from '@core/components';
import { CatalogPricingSystem } from '@core/systems';
import type { Barber, Service } from '@core/entities';
import type {
  BarberVm,
  Localized,
  ServiceOfferingVm,
  ServiceTermsVm,
  ServiceVm,
  ServiceVariantVm,
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
 * Cents → the VM's major-unit number (`1450` → `14.5`). The VM is EUR major
 * units by contract (`catalog.vm.ts`); EUR's exponent is 2.
 */
function toMajor(cents: PriceCents): number {
  return cents / 100;
}

/**
 * The flat terms → the VM's terms, in major units — an offering's base, a
 * variant's terms, or a barber's terms for a service (the landing's
 * `LandingContentService.barberPrices`).
 */
export function termsToVm(terms: ServiceTerms): ServiceTermsVm {
  return { price: toMajor(terms.priceCents), minutes: terms.durationMinutes };
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
    icon: 'length',
  }));

  const offerings = service.offerings.map(offeringToVm);

  // An unspecified composition (`composition: null` as authored) draws as a
  // single service — the companion's rule, never re-spelled here.
  const compositionKind = ServiceComposition.drawnKind(service.compositionKind);
  // The catalogue's figures, asked ONCE of the system, on the entity itself.
  const card = CatalogPricingSystem.cardPrice(service);
  const minutes = CatalogPricingSystem.durationRange(service);
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
    priceFrom: toMajor(CatalogPricingSystem.priceFrom(service)),
    cardPrice: { cheapest: toMajor(card.cheapestCents), spread: card.spread },
    minutesRange: { from: minutes.min, to: minutes.max },
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

// ─── Formatting (v2 lib/format-money + format-duration semantics) ────────

/** Whole amounts drop the zeros (5 €), fractional keep two (14,50 €). */
/**
 * Money strings come out of `Intl.NumberFormat` with the CURRENCY's own
 * fraction digits — two for EUR — rather than a hand-tuned digit count.
 *
 * The old rule dropped decimals on whole amounts, which read fine in
 * isolation but broke the one thing every price in this app is styled for:
 * `font-variant-numeric: tabular-nums` only aligns a COLUMN when the
 * strings share a shape, and `28 €` next to `25,50 €` puts the separators
 * at different offsets. Letting the formatter decide restores the
 * alignment we were already paying for, and matches the platform
 * convention (NumberFormatter.currency never drops a currency's decimals).
 */
export function formatPrice(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
  }).format(major);
}

/**
 * Cents → the catalogue's money string: {@link formatPrice} on the major
 * units, for a figure a system answered in cents (the bundle saving).
 */
export function formatPriceCents(cents: PriceCents, locale: string): string {
  return formatPrice(toMajor(cents), locale);
}

export function formatDurationRange(
  min: number,
  max: number,
  locale: string,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
  });
  if (min === max) return formatter.format(min);
  // `formatRange` postdates the workspace TS lib — feature-detect at runtime.
  const ranged = formatter as Intl.NumberFormat & {
    formatRange?: (start: number, end: number) => string;
  };
  if (typeof ranged.formatRange === 'function') {
    return ranged.formatRange(min, max);
  }
  return `${new Intl.NumberFormat(locale, { useGrouping: false }).format(min)}–${formatter.format(max)}`;
}

/**
 * Cheapest base offering — the "from" price on a marketing tile: the
 * `CatalogPricingSystem.priceFrom` answer the view model carries.
 */
export function servicePriceFrom(service: ServiceVm): number {
  return service.priceFrom;
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
export function serviceDurationRange(service: ServiceVm): {
  from: number;
  to: number;
} {
  return { from: service.minutesRange.from, to: service.minutesRange.to };
}
