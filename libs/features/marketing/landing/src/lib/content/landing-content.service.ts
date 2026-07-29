import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import {
  CATALOG_READER,
  MEDIA_READER,
  type Barber,
  type MediaRef,
  type Service,
} from '@creativo/application/catalog';
import { LanguageService } from '@creativo/features/shared/shell';
import {
  BARBER_ART,
  SERVICE_ART,
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
import { barberToVm, serviceToVm } from './catalog-to-vm';

/**
 * The landing's single content source — now the REAL catalog.
 *
 * `CATALOG_READER` feeds services and barbers, `MEDIA_READER` resolves
 * their cover/avatar `MediaRef`s to URLs, and `catalog-to-vm` maps both
 * onto the `ServiceVm`/`BarberVm` shapes the sections already bind. The
 * page and the onboarding grid finally read ONE source, which is what
 * stopped them disagreeing about which services exist and what they cost.
 *
 * Still hand-authored: locations and work shots (no seeded counterpart
 * yet), and the editorial art direction merged in by `catalog-to-vm`.
 *
 * Collections are SIGNALS now, not plain arrays — Firestore answers
 * asynchronously, and templates re-read them as the catalog arrives.
 */
@Injectable({ providedIn: 'root' })
export class LandingContentService {
  private readonly language = inject(LanguageService);
  private readonly catalog = inject(CATALOG_READER);
  private readonly media = inject(MEDIA_READER);

  /** Intl locale for money/durations — tracks the active language. */
  readonly locale = computed(() => this.language.activeLang());

  readonly workShots: readonly WorkShotVm[] = WORK_SHOTS;
  readonly locations: readonly LocationVm[] = LOCATIONS;

  /** Resolved media URLs by `MediaRef` id — filled as `MEDIA_READER` answers. */
  private readonly mediaUrls = signal<Readonly<Record<string, string>>>({});
  private readonly mediaRequests = new Set<string>();

  private readonly domainServices = toSignal(
    this.catalog
      .listActiveServices()
      .pipe(map((result) => (result.isSuccess() ? result.value : []))),
    { initialValue: [] as readonly Service[] },
  );

  private readonly domainBarbers = toSignal(
    this.catalog
      .listActiveBarbers()
      .pipe(map((result) => (result.isSuccess() ? result.value : []))),
    { initialValue: [] as readonly Barber[] },
  );

  readonly barbers = computed<readonly BarberVm[]>(() =>
    this.domainBarbers().map((barber) =>
      barberToVm(
        barber,
        barber.avatar ? this.mediaUrls()[barber.avatar.id.value] : undefined,
        BARBER_ART[barber.id.value],
      ),
    ),
  );

  readonly allServices = computed<readonly ServiceVm[]>(() =>
    this.domainServices().map((service) =>
      serviceToVm(
        service,
        service.cover ? this.mediaUrls()[service.cover.id.value] : undefined,
        SERVICE_ART[service.id.value],
      ),
    ),
  );

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

  constructor() {
    // Resolve every cover/avatar exactly once. A live-query re-emit hands
    // back the same refs, so `mediaRequests` keeps a snapshot from
    // re-fetching what is already in flight.
    effect(() => {
      const refs: MediaRef[] = [
        ...this.domainServices().map((service) => service.cover),
        ...this.domainBarbers().map((barber) => barber.avatar),
      ].filter((ref): ref is MediaRef => ref !== null);

      for (const ref of refs) {
        const id = ref.id.value;
        if (this.mediaRequests.has(id)) continue;
        this.mediaRequests.add(id);
        void this.media.resolve(ref).then((result) => {
          if (result.isFailure()) return;
          const [variant] = result.value;
          if (!variant) return;
          this.mediaUrls.update((urls) => ({ ...urls, [id]: variant.url }));
        });
      }
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
