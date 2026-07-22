import { Injectable, computed, inject } from '@angular/core';
import { LanguageService } from '../language.service';
import {
  BARBERS,
  type BarberVm,
  type DayHoursVm,
  LOCATIONS,
  type Localized,
  type LocationVm,
  SERVICES,
  type ServiceVm,
  WORK_SHOTS,
  type WorkShotVm,
  formatDurationRange,
  formatPrice,
} from './landing-content';

/**
 * The landing's single content source. Serves the bundled demo seed — the SAME
 * data v2's landing renders through its in-memory catalog port — so the page
 * is pixel- and content-identical to the reference out of the box.
 *
 * Live-catalog overlay (`CATALOG_READER`/`MEDIA_READER`) is the follow-up seam
 * tracked on the parity checklist: when Firestore carries tenant content, this
 * service is where the fixture yields to `listActiveServices()` & co. — the
 * "demo seed today, Firestore tomorrow" posture v2 itself ships with.
 */
@Injectable({ providedIn: 'root' })
export class LandingContentService {
  private readonly language = inject(LanguageService);

  /** Intl locale for money/durations — tracks the active language. */
  readonly locale = computed(() => this.language.activeLang());

  readonly workShots: readonly WorkShotVm[] = WORK_SHOTS;
  readonly barbers: readonly BarberVm[] = BARBERS;
  readonly locations: readonly LocationVm[] = LOCATIONS;

  /** Marketing shelf — upsell-only add-ons belong to /book, not here (v2). */
  readonly shelfServices: readonly ServiceVm[] = SERVICES.filter(
    (service) => !service.upsellOnly,
  );
  readonly singleServices: readonly ServiceVm[] = this.shelfServices.filter(
    (service) => service.kind === 'single',
  );
  readonly bundleServices: readonly ServiceVm[] = this.shelfServices.filter(
    (service) => service.kind === 'bundle',
  );
  readonly allServices: readonly ServiceVm[] = SERVICES;

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
