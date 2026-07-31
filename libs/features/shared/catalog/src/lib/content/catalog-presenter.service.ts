import { Injectable, computed, inject } from '@angular/core';
import { LanguageService } from '@creativo/features/shared/shell';
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
    // contradict one tap later.
    const prices = service.offerings.flatMap((offering) => [
      offering.base.price,
      ...Object.values(offering.byVariant ?? {}).map((term) => term.price),
    ]);
    const cheapest = prices.length > 0 ? Math.min(...prices) : 0;
    return formatServiceMeta({
      price: this.price(cheapest),
      fromLabel,
      spread: prices.length > 0 && Math.max(...prices) > cheapest,
    });
  }
}
