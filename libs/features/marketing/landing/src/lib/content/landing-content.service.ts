import {
  CatalogContentService,
  termsToVm,
} from '@creativo/features/shared/catalog';
import { Injectable, type Signal, computed, inject } from '@angular/core';
import { BarberId } from '@core/primitives';
import { CompositionKind } from '@core/components';
import { CatalogPricingSystem } from '@core/systems';
import { LanguageService } from '@creativo/features/shared/shell';
import {
  type BarberVm,
  LOCATIONS,
  type Localized,
  type LocationVm,
  type ServiceTermsVm,
  type ServiceVm,
  WORK_SHOTS,
  type WorkShotVm,
  formatDurationRange,
  formatPrice,
} from './landing-content';

/**
 * The landing's single content source — now the REAL catalog.
 *
 * Services and barbers are `CatalogContentService`'s view models: the
 * session's one catalogue read and its one media cache, the same the
 * booking flow and onboarding read. A visitor who goes from the landing to
 * `/book` resolves each cover once, and a missing cover costs one request a
 * session, not one per surface. (The landing kept a second `MediaUrlCache`
 * and its own catalogue subscriptions until 2026-09-26.) The page and the
 * onboarding grid read ONE source, which is what stopped them disagreeing
 * about which services exist and what they cost.
 *
 * Still hand-authored: locations and work shots (no seeded counterpart
 * yet), and the editorial art direction merged in by `catalog.presenter.ts`.
 *
 * Collections are SIGNALS, not plain arrays — Firestore answers
 * asynchronously, and templates re-read them as the catalog arrives.
 */
@Injectable({ providedIn: 'root' })
export class LandingContentService {
  private readonly language = inject(LanguageService);
  private readonly catalog = inject(CatalogContentService);

  /** Intl locale for money/durations — tracks the active language. */
  readonly locale = computed(() => this.language.activeLang());

  readonly workShots: readonly WorkShotVm[] = WORK_SHOTS;
  readonly locations: readonly LocationVm[] = LOCATIONS;

  /** Active barbers, their avatars resolved — the catalogue's own view models. */
  readonly barbers: Signal<readonly BarberVm[]> = this.catalog.barberVms;

  /** Active services, their covers resolved — the catalogue's own view models. */
  readonly allServices: Signal<readonly ServiceVm[]> = this.catalog.serviceVms;

  /** Marketing shelf — upsell-only add-ons belong to /book, not here (v2). */
  readonly shelfServices = computed<readonly ServiceVm[]>(() =>
    this.allServices().filter((service) => !service.upsellOnly),
  );
  readonly singleServices = computed<readonly ServiceVm[]>(() =>
    this.shelfServices().filter(
      (service) => service.compositionKind === CompositionKind.Single,
    ),
  );
  readonly bundleServices = computed<readonly ServiceVm[]>(() =>
    this.shelfServices().filter(
      (service) => service.compositionKind === CompositionKind.Bundle,
    ),
  );

  /**
   * Every shelf service a barber performs, with THEIR terms for it — the
   * inverse of the offerings, the only direction the catalogue stores
   * (`CatalogPricingSystem.servicesByBarber`). Asked of the domain services
   * the shelf holds (same set, same order), so upsell-only add-ons stay out
   * of it exactly as they do from the shelf itself.
   */
  barberPrices(barberId: string): readonly {
    readonly service: ServiceVm;
    readonly terms: ServiceTermsVm;
  }[] {
    const shelf = new Map(
      this.shelfServices().map((service) => [service.id, service]),
    );
    const services = this.catalog
      .services()
      .filter((service) => shelf.has(service.id));
    return CatalogPricingSystem.servicesByBarber(
      services,
      BarberId.of(barberId),
    ).flatMap((entry) => {
      const service = shelf.get(entry.service.id);
      return service ? [{ service, terms: termsToVm(entry.terms) }] : [];
    });
  }

  /** Resolve a localized pair against the active language. */
  text(localized: Localized): string {
    return localized[this.language.activeLang()] ?? localized.en;
  }

  price(major: number): string {
    return formatPrice(major, this.locale());
  }

  durationRange(from: number, to: number): string {
    return formatDurationRange(from, to, this.locale());
  }
}
