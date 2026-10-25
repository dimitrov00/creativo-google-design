import type { CompositionKind } from '@core/components';
import type {
  BarberId,
  Currency,
  DurationMinutes,
  PriceCents,
  ServiceId,
  ServiceVariantId,
} from '@core/primitives';
import type { CardPrice, OfferingRange } from '@core/systems';

/**
 * The catalog view models every surface renders — landing shelf, onboarding
 * grid, and the booking flow next. They live in `features/shared/catalog`
 * rather than any one feature because the service-detail sheet is shared,
 * and a view model owned by the marketing lib would have made onboarding
 * depend on marketing to show a service.
 *
 * Presentational by design: localized strings stay `{ en, bg }` pairs
 * resolved at render time; money is integer `…Cents: PriceCents` beside its
 * `currency` (worded by `CatalogWording.price` through `formatCents`),
 * durations are `DurationMinutes`, ids are the catalogue's brands.
 * `catalog.presenter.ts` maps the domain aggregates onto these and words them
 * (Law 10: a display model holds types only).
 */

export interface Localized {
  readonly en: string;
  readonly bg: string;
}

// ─── Barbers ────────────────────────────────────────────────────────────

export interface BarberVm {
  readonly id: BarberId;
  readonly name: Localized;
  readonly title: Localized;
  readonly bio: Localized;
  readonly avatarSrc: string;
  /** v2 seeds every avatar with FocalPoint(0.5, 0.25) → object-position. */
  readonly objectPosition: string;
  /** Client rating (★ 0–5, one decimal) — omitted for barbers without
   *  enough reviews yet. */
  readonly rating?: number;
  /** The one-line craft summary the team cards read. */
  readonly specialty: Localized;
  /** Selected work, for the barber destination's gallery. */
  readonly gallery: readonly string[];
}

// ─── Services ───────────────────────────────────────────────────────────

/** One terms quote — the cents beside their currency, and the sold minutes. */
export interface ServiceTermsVm {
  readonly priceCents: PriceCents;
  readonly currency: Currency;
  readonly minutes: DurationMinutes;
}

/** Who performs a service, at their base terms. */
export interface ServiceOfferingVm {
  readonly barberId: BarberId;
  readonly base: ServiceTermsVm;
}

/**
 * The mark a variant wears — a rendering choice, never catalogue data
 * (internal: the detail sheet maps it to a registry key, nothing prints the
 * value).
 */
export const VariantIcon = {
  Length: 'LENGTH',
  Skin: 'SKIN',
} as const;
export type VariantIcon = (typeof VariantIcon)[keyof typeof VariantIcon];

export interface ServiceVariantVm {
  readonly id: ServiceVariantId;
  readonly name: Localized;
  readonly icon: VariantIcon;
}

/**
 * A service's authored fields, as the `Service` entity carries them (the
 * landing's demo shelf authors its own raw input type and builds entities
 * from it — `src/testing/landing-catalog.ts`).
 * It carries no figures: the figures are `CatalogPricingSystem`'s answers on
 * the `Service` entity, and only {@link ServiceVm} — built from that entity —
 * holds them.
 */
export interface ServiceSourceVm {
  readonly id: ServiceId;
  /**
   * Single or bundle — the catalogue's own `CompositionKind` (reused, never
   * re-spelled); an unspecified composition draws as a single service, so
   * the view model never carries `UNSPECIFIED`.
   */
  readonly compositionKind: Exclude<
    CompositionKind,
    typeof CompositionKind.Unspecified
  >;
  readonly name: Localized;
  readonly description: Localized;
  readonly coverSrc?: string;
  readonly variants: readonly ServiceVariantVm[];
  readonly offerings: readonly ServiceOfferingVm[];
  /** Bundle members, by service id. */
  readonly includes?: readonly ServiceId[];
  readonly upsellOnly: boolean;
  /** Gallery frames for the detail sheet (v2 serviceLinks order). */
  readonly gallery: readonly string[];
}

/**
 * A service ready to render: the authored fields plus the catalogue's own
 * figures, each `CatalogPricingSystem`'s answer on the `Service` entity
 * (`catalog.presenter.ts` `serviceToVm` asks it once). Integer cents in the
 * service's stored `currency`, branded minutes.
 */
export interface ServiceVm extends ServiceSourceVm {
  /** The service's stored currency — every figure below is in it. */
  readonly currency: Currency;
  /** The cheapest BASE offering — the "from" price on a marketing tile. */
  readonly priceFromCents: PriceCents;
  /**
   * The card's price tag over every bookable terms: the cheapest, and
   * whether some terms cost more (the tag then reads «от …»).
   */
  readonly cardPrice: CardPrice;
  /** Shortest and longest bookable duration, across offerings × variants. */
  readonly minutesRange: OfferingRange<DurationMinutes>;
}
