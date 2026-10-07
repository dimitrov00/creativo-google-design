import { CatalogContentService } from '@creativo/features/shared/catalog';
import { Injectable, type Signal, computed, inject } from '@angular/core';
import { LanguageService } from '@creativo/features/shared/shell';
import {
  type BarberVm,
  type DayHoursVm,
  LOCATIONS,
  type Localized,
  type LocationVm,
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
 * yet), and the editorial art direction merged in by `catalog-to-vm`.
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
    this.shelfServices().filter((service) => service.kind === 'single'),
  );
  readonly bundleServices = computed<readonly ServiceVm[]>(() =>
    this.shelfServices().filter((service) => service.kind === 'bundle'),
  );

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

  /** Monday-first ISO weekday index at the location, per its timezone. */
  todayIndexAt(location: LocationVm, now: Date = new Date()): number {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: location.timezone,
      weekday: 'short',
    }).format(now);
    const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Math.max(0, order.indexOf(weekday));
  }

  /** Open right now? — v2 `isOpenNow` semantics ([opens, closes) local time). */
  isOpenNow(location: LocationVm, now: Date = new Date()): boolean {
    const today: DayHoursVm | undefined =
      location.hours[this.todayIndexAt(location, now)];
    if (!today || today.kind === 'closed') return false;
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: location.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    return time >= today.opens && time < today.closes;
  }

  /** Localized weekday label for the hours grid (v2 `weekdayLabel` — long). */
  weekdayLabel(isoIndex: number): string {
    // 2024-01-01 is a Monday — offset from it keeps the mapping ISO-stable.
    const monday = Date.UTC(2024, 0, 1);
    const date = new Date(monday + isoIndex * 86_400_000);
    return new Intl.DateTimeFormat(this.locale(), {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(date);
  }
}
