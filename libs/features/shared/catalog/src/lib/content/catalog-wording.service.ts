import { Injectable, computed, inject } from '@angular/core';
import type { LocalizedText, Money } from '@core/components';
import type { DurationMinutes } from '@core/primitives';
import { LanguageService } from '@creativo/features/shared/shell';
import { formatCents, formatMinutesRange } from '@creativo/ui/wall-clock';
import { type ServiceVm } from './catalog.vm';
import { formatServiceMeta, serviceCardPrice } from './catalog.presenter';

/**
 * The three locale-bound reads every catalog surface needs: resolve a
 * `LocalizedText` pair, format money, format a duration range.
 *
 * Extracted from `LandingContentService` so the service-detail sheet can
 * be rendered by ANY feature — onboarding, booking — without dragging the
 * marketing lib's content source in behind it. The landing's components
 * inject it directly, as every other catalog surface does.
 */
@Injectable({ providedIn: 'root' })
export class CatalogWording {
  private readonly language = inject(LanguageService);

  /** Intl locale for money/durations — tracks the active language. */
  readonly locale = computed(() => this.language.activeLang());

  /** Resolve a localized pair against the active language. */
  text(localized: LocalizedText): string {
    return localized[this.language.activeLang()] ?? localized.en;
  }

  /**
   * An amount in the active language — «28,00 €» — through the ONE money
   * formatter (`formatCents`: the stored currency's own symbol and fraction
   * digits), at the catalogue's locale (`'bg'`/`'en'`, byte-identical to the
   * retired EUR-only presenter formatter for every EUR amount — pass D,
   * DEP-19).
   */
  price(money: Money): string {
    return formatCents(money.amountCents, money.currency, this.locale());
  }

  /**
   * A duration range in the active language — «30 – 50 мин» — through the
   * shared cached minutes formatter (`formatMinutesRange`, pass E, E-12).
   */
  durationRange(from: DurationMinutes, to: DurationMinutes): string {
    return formatMinutesRange(from, to, this.locale());
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
    // contradict one tap later. The tag is `CatalogPricingSystem.cardPrice`'s
    // answer, carried on the view model (`serviceToVm`).
    return formatServiceMeta({
      price: this.price(serviceCardPrice(service)),
      fromLabel,
      spread: service.cardPrice.spread,
    });
  }
}
