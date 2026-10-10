import { Injectable, computed, inject } from '@angular/core';
import { LanguageService } from '@creativo/features/shared/shell';
import {
  BarberId,
  type CatalogPriced,
  CatalogPricingSystem,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/ecs-core';
import {
  type Localized,
  type ServiceVm,
  formatDurationRange,
  formatPrice,
  formatServiceMeta,
} from './catalog-vm';

/**
 * The three locale-bound reads every catalog surface needs: resolve a
 * `Localized` pair, format money, format a duration range.
 *
 * Extracted from `LandingContentService` so the service-detail sheet can
 * be rendered by ANY feature — onboarding, booking — without dragging the
 * marketing lib's content source in behind it. That service now delegates
 * here rather than duplicating the formatting.
 */
@Injectable({ providedIn: 'root' })
export class CatalogPresenter {
  private readonly language = inject(LanguageService);

  /** Intl locale for money/durations — tracks the active language. */
  readonly locale = computed(() => this.language.activeLang());

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

  /**
   * The service card's second line — `от 13,00 €`.
   *
   * PRICE ONLY: the card is a price tag, and the sheet it opens states the
   * duration in its own facts row a tap later (owner ruling 2026-07-31).
   * `fromLabel` comes from the caller's own `t` — this service has no
   * transloco of its own, and every call site is already inside one.
   */
  serviceMeta(service: ServiceVm, fromLabel: string): string {
    // EVERY bookable term, not just the base ones — a card that folded only
    // `offering.base` quoted a cheapest price the sheet it opens could
    // contradict one tap later (`CatalogPricingSystem.cardPrice`).
    const tag =
      service.offerings.length > 0
        ? CatalogPricingSystem.cardPrice(pricedOf(service))
        : { cheapestMinorUnits: 0, spread: false };
    return formatServiceMeta({
      price: this.price(tag.cheapestMinorUnits / 100),
      fromLabel,
      spread: tag.spread,
    });
  }
}

/* ── Phase 2 shim converter: the view model → the catalogue's terms ─────── */

/** EUR major units → the terms matrix the pricing system reads. */
function pricedOf(service: ServiceVm): CatalogPriced {
  const terms = (vm: { readonly price: number; readonly minutes: number }) =>
    ServiceTerms.unpadded(Math.round(vm.price * 100), 'EUR', vm.minutes);
  const variantIds = new Set(service.variants.map((variant) => variant.id));
  for (const offering of service.offerings) {
    for (const id of Object.keys(offering.byVariant ?? {})) variantIds.add(id);
  }
  const first = service.offerings[0];
  return {
    baseTerms: first ? terms(first.base) : ServiceTerms.unpadded(0, 'EUR', 0),
    variants: [...variantIds].map((id) => ({
      id: ServiceVariantId.of(id),
      name: { bg: id, en: id },
    })),
    offerings: service.offerings.map((offering) => ({
      barberId: BarberId.of(offering.barberId),
      base: terms(offering.base),
      overrides: Object.entries(offering.byVariant ?? {}).map(
        ([variantId, variantTerms]) => ({
          variantId: ServiceVariantId.of(variantId),
          terms: terms(variantTerms),
        }),
      ),
    })),
  };
}
