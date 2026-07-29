import { Injectable, computed, inject } from '@angular/core';
import { LanguageService } from '@creativo/features/shared/shell';
import { type Localized, formatDurationRange, formatPrice } from './catalog-vm';

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
}
