/**
 * The catalog view models every surface renders — landing shelf, onboarding
 * grid, and the booking flow next. They live in `features/shared/catalog`
 * rather than any one feature because the service-detail sheet is shared,
 * and a view model owned by the marketing lib would have made onboarding
 * depend on marketing to show a service.
 *
 * Presentational by design: localized strings stay `{ en, bg }` pairs
 * resolved at render time, money is EUR major units, durations are minutes.
 * `catalog-to-vm` maps the domain aggregates onto these.
 */

export interface Localized {
  readonly en: string;
  readonly bg: string;
}

// ─── Barbers ────────────────────────────────────────────────────────────

export interface BarberVm {
  readonly id: string;
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

export interface ServiceTermsVm {
  /** EUR, major units (may carry .5). */
  readonly price: number;
  readonly minutes: number;
}

export interface ServiceOfferingVm {
  readonly barberId: string;
  readonly base: ServiceTermsVm;
  readonly byVariant?: Readonly<Record<string, ServiceTermsVm>>;
}

export interface ServiceVariantVm {
  readonly id: string;
  readonly name: Localized;
  readonly icon: 'length' | 'skin';
}

export interface ServiceVm {
  readonly id: string;
  readonly kind: 'single' | 'bundle';
  readonly name: Localized;
  readonly description: Localized;
  readonly coverSrc?: string;
  readonly variants: readonly ServiceVariantVm[];
  readonly offerings: readonly ServiceOfferingVm[];
  /** Bundle members, by service id. */
  readonly includes?: readonly string[];
  readonly upsellOnly: boolean;
  /** Gallery frames for the detail sheet (v2 serviceLinks order). */
  readonly gallery: readonly string[];
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
  return Math.min(...service.offerings.map((offering) => offering.base.price));
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
  return services.flatMap((service) => {
    const offering = service.offerings.find(
      (candidate) => candidate.barberId === barberId,
    );
    return offering ? [{ service, terms: offering.base }] : [];
  });
}

/** Global duration range across offerings × variants (v2 Service.durationRange). */
export function serviceDurationRange(service: ServiceVm): {
  from: number;
  to: number;
} {
  const minutes = service.offerings.flatMap((offering) => [
    offering.base.minutes,
    ...Object.values(offering.byVariant ?? {}).map((terms) => terms.minutes),
  ]);
  return { from: Math.min(...minutes), to: Math.max(...minutes) };
}
