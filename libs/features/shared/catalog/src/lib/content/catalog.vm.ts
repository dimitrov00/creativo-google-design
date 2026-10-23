import { CompositionKind } from '@core/components';

/**
 * The catalog view models every surface renders — landing shelf, onboarding
 * grid, and the booking flow next. They live in `features/shared/catalog`
 * rather than any one feature because the service-detail sheet is shared,
 * and a view model owned by the marketing lib would have made onboarding
 * depend on marketing to show a service.
 *
 * Presentational by design: localized strings stay `{ en, bg }` pairs
 * resolved at render time, money is EUR major units, durations are minutes.
 * `catalog.presenter.ts` maps the domain aggregates onto these and words them
 * (Law 10: a display model holds types only).
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
  readonly includes?: readonly string[];
  readonly upsellOnly: boolean;
  /** Gallery frames for the detail sheet (v2 serviceLinks order). */
  readonly gallery: readonly string[];
}
