import {
  BarberId,
  Currency,
  DurationMinutes,
  PriceCents,
  ServiceVariantId,
  defect,
} from '@core/primitives';
import {
  BarberOffering,
  CompositionKind,
  ServiceTerms,
  type ServiceVariant,
} from '@core/components';
import { type CatalogPriced, CatalogPricingSystem } from '@core/systems';
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
 * The flat terms → the VM's major-unit number (`1450` cents → `14.5`). The
 * VM is EUR major units by contract (`catalog.vm.ts`); EUR's exponent is 2.
 */
function termsToVm(terms: ServiceTerms): ServiceTermsVm {
  return { price: terms.priceCents / 100, minutes: terms.durationMinutes };
}

function offeringToVm(
  offering: BarberOffering,
  /** The service's declared variants — `termsFor` takes the variant's id. */
  variants: readonly ServiceVariant[],
): ServiceOfferingVm {
  const byVariant: Record<string, ServiceTermsVm> = {};
  for (const variant of variants) {
    // Ask the offering for every declared variant and let its own sparse
    // fallback decide. Terms equal to base are still written out: the VM's
    // helpers read this map directly and have no fallback of their own.
    byVariant[variant.variantId] = termsToVm(
      BarberOffering.termsFor(offering, variant.variantId),
    );
  }
  return {
    barberId: offering.barberId,
    // The offering's own five root fields ARE its base terms (the slice).
    base: termsToVm(offering),
    ...(variants.length > 0 ? { byVariant } : {}),
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

  const offerings = service.offerings.map((offering) =>
    offeringToVm(offering, service.variants),
  );

  const bundle = service.compositionKind === CompositionKind.Bundle;
  return {
    id: service.id,
    // An unspecified composition (`composition: null` as authored) draws as
    // a single service, as it always did.
    compositionKind: bundle ? CompositionKind.Bundle : CompositionKind.Single,
    name: localized(service.name),
    description: localized(service.description),
    ...(coverSrc ? { coverSrc } : {}),
    variants,
    // A service nobody is priced for yet still has to show a price, so its
    // own terms (the five root fields) stand in as a single anonymous
    // offering. Without this the VM's `servicePriceFrom` would fold an empty
    // list.
    offerings:
      offerings.length > 0
        ? offerings
        : [{ barberId: '', base: termsToVm(service) }],
    ...(service.compositionKind === CompositionKind.Bundle
      ? { includes: [...service.bundleServiceIds] }
      : {}),
    upsellOnly: service.upsellOnly,
    gallery: art?.gallery ?? [],
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

/** Cheapest base offering — the "from" price on a marketing tile. */
export function servicePriceFrom(service: ServiceVm): number {
  const priced = pricedOf(service);
  // A view model nobody performs carries no price: never the cheapest.
  return priced === null
    ? Number.POSITIVE_INFINITY
    : toMajor(CatalogPricingSystem.priceFrom(priced));
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
 * Every service a barber performs, with THEIR terms for it — the inverse
 * of `ServiceVm.offerings`, which is the only direction the seed stores.
 *
 * The caller passes the service set, so the marketing surface can hand in
 * the shelf (upsell-only add-ons stay out of it, exactly as they do from
 * the shelf itself) while a booking surface could pass everything.
 */
export function servicesByBarber(
  services: readonly ServiceVm[],
  barberId: string,
): readonly { readonly service: ServiceVm; readonly terms: ServiceTermsVm }[] {
  // A service nobody performs is nobody's: it cannot be in the answer.
  const performed = services.filter((service) => service.offerings.length > 0);
  const priced = performed.map((service) => pricedOf(service) as CatalogPriced);
  return CatalogPricingSystem.servicesByBarber(
    priced,
    BarberId.of(barberId),
  ).map((entry) => ({
    service: performed.at(priced.indexOf(entry.service)) as ServiceVm,
    terms: termsVmOf(entry.terms),
  }));
}

/** Global duration range across offerings × variants (v2 Service.durationRange). */
export function serviceDurationRange(service: ServiceVm): {
  from: number;
  to: number;
} {
  const priced = pricedOf(service);
  if (priced === null) return { from: 0, to: 0 };
  const range = CatalogPricingSystem.durationRange(priced);
  return { from: range.min, to: range.max };
}

/* ── Phase 2 shim converters: the view model ↔ the catalogue's terms ────── */

/** EUR major units (may carry .5) → minor units. */
function toMinor(major: number): number {
  return Math.round(major * 100);
}

function toMajor(minor: number): number {
  return minor / 100;
}

/** A brand the view model's figure already satisfies (catalogue terms, mapped). */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: `catalog.presenter.ts` maps the catalogue's own terms — a
  // non-negative price and a positive duration.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function termsOf(terms: ServiceTermsVm): ServiceTerms {
  return ServiceTerms.unpadded(
    sure(PriceCents.of(toMinor(terms.price)), 'a price'),
    Currency.EUR,
    sure(DurationMinutes.of(terms.minutes), 'a duration'),
  );
}

function termsVmOf(terms: ServiceTerms): ServiceTermsVm {
  return {
    price: toMajor(terms.priceCents),
    minutes: terms.durationMinutes,
  };
}

/**
 * The view model's offerings → the terms matrix the pricing system reads:
 * each `byVariant` entry an override, every variant it names declared. The
 * view model always carries an offering (a service nobody performs stands
 * in as one anonymous offering), whose base doubles as the service's own
 * terms; `null` for one that carries none — it has no terms to read.
 */
function pricedOf(service: ServiceVm): CatalogPriced | null {
  const first = service.offerings[0];
  if (first === undefined) return null;
  const variantIds = new Set(service.variants.map((variant) => variant.id));
  for (const offering of service.offerings) {
    for (const id of Object.keys(offering.byVariant ?? {})) variantIds.add(id);
  }
  return {
    ...termsOf(first.base),
    variants: [...variantIds].map((id) => ({
      variantId: ServiceVariantId.of(id),
      name: { bg: id, en: id },
    })),
    offerings: service.offerings.map((offering) => ({
      barberId: BarberId.of(offering.barberId),
      ...termsOf(offering.base),
      overrides: Object.entries(offering.byVariant ?? {}).map(
        ([variantId, terms]) => ({
          variantId: ServiceVariantId.of(variantId),
          ...termsOf(terms),
        }),
      ),
    })),
  };
}
