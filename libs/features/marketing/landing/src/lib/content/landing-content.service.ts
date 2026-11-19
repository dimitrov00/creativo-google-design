import {
  type BarberVm,
  CatalogContentService,
  type ServiceTermsVm,
  type ServiceVm,
  termsToVm,
} from '@creativo/features/shared/catalog';
import { Injectable, type Signal, computed, inject } from '@angular/core';
import type { BarberId } from '@core/primitives';
import { CompositionKind } from '@core/components';
import type { ShopLocation } from '@core/entities';
import { CatalogPricingSystem, CatalogSystem } from '@core/systems';
import { LANDING_WORK_SHOTS, type WorkShotVm } from './landing-content';

/**
 * The landing's single content source — the REAL catalog.
 *
 * Services, barbers and shops are `CatalogContentService`'s: the
 * session's one catalogue read and its one media cache, the same the
 * booking flow and onboarding read. A visitor who goes from the landing to
 * `/book` resolves each cover once, and a missing cover costs one request a
 * session, not one per surface. (The landing kept a second `MediaUrlCache`
 * and its own catalogue subscriptions until 2026-09-26.) The page and the
 * onboarding grid read ONE source, which is what stopped them disagreeing
 * about which services exist and what they cost.
 *
 * Still hand-authored: the work strip's shots (`LANDING_WORK_SHOTS`, none
 * until the owner supplies the shop's own photos) and the editorial art
 * direction merged in by `catalog.presenter.ts` (`CATALOG_ART`, none yet).
 * A section with nothing stored to show is not drawn at all — and not
 * before its read has answered, so a slow read never flashes an empty
 * section ({@link showsTeam} and its siblings).
 * The words its templates print — a localized pair, a price — are
 * `CatalogWording`'s, the locale-bound reads every catalog surface shares;
 * the landing's components inject it themselves.
 *
 * Collections are SIGNALS, not plain arrays — Firestore answers
 * asynchronously, and templates re-read them as the catalog arrives.
 */
@Injectable({ providedIn: 'root' })
export class LandingContentService {
  private readonly catalog = inject(CatalogContentService);

  /** The work strip's shots — none until the owner supplies the shop's own. */
  readonly workShots: readonly WorkShotVm[] = inject(LANDING_WORK_SHOTS);

  /** Public barbers in their `sortOrder`, avatars resolved — the catalogue's own view models. */
  readonly barbers: Signal<readonly BarberVm[]> = this.catalog.barberVms;

  /** Active shops in their `sortOrder` (the read orders them). */
  readonly shops: Signal<readonly ShopLocation[]> = this.catalog.locations;

  /**
   * The flagship shop — the first by `sortOrder` — whose map and phone the
   * footer's Visit column links to; `null` while none is known.
   */
  readonly flagship = computed<ShopLocation | null>(
    () => this.shops()[0] ?? null,
  );

  /** The work strip is drawn only with shots to show. */
  readonly showsWork = this.workShots.length > 0;

  /**
   * The services shelf is drawn once the services AND the barbers have
   * answered (the public shelf counts listed barbers' offerings only) and
   * the shelf holds a service.
   */
  readonly showsServices = computed(
    () =>
      this.catalog.servicesKnown() &&
      this.catalog.barbersKnown() &&
      this.shelfServices().length > 0,
  );

  /** The team is drawn once the barbers have answered, with a public barber on it. */
  readonly showsTeam = computed(
    () => this.catalog.barbersKnown() && this.barbers().length > 0,
  );

  /** The shops (the «Visit» section) are drawn once they have answered, with an active shop. */
  readonly showsShops = computed(
    () => this.catalog.locationsKnown() && this.shops().length > 0,
  );

  /** A shop's own stored photos, resolved so far (`CatalogContentService.photoUrlsOf`). */
  shopPhotos(location: ShopLocation): readonly string[] {
    return this.catalog.photoUrlsOf(location);
  }

  /** Active services, their covers resolved — the catalogue's own view models. */
  readonly allServices: Signal<readonly ServiceVm[]> = this.catalog.serviceVms;

  /** Marketing shelf — upsell-only add-ons belong to /book, not here (v2): `CatalogSystem.shelf`. */
  readonly shelfServices = computed<readonly ServiceVm[]>(() =>
    CatalogSystem.shelf(this.allServices()),
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
   * on the shelf (`CatalogSystem.shelf`, the one rule — same set, same
   * order), so upsell-only add-ons stay out of it exactly as they do from
   * the shelf itself.
   */
  barberPrices(barberId: BarberId): readonly {
    readonly service: ServiceVm;
    readonly terms: ServiceTermsVm;
  }[] {
    const shelf = new Map(
      this.shelfServices().map((service) => [service.id, service]),
    );
    return CatalogPricingSystem.servicesByBarber(
      CatalogSystem.shelf(this.catalog.services()),
      barberId,
    ).flatMap((entry) => {
      const service = shelf.get(entry.service.id);
      return service ? [{ service, terms: termsToVm(entry.terms) }] : [];
    });
  }
}
