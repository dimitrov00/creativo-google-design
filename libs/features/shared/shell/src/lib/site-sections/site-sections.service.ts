import {
  DestroyRef,
  Injectable,
  type Signal,
  type WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import type { Result } from '@core/primitives';
import type { Barber, Service, ShopLocation } from '@core/entities';
import { CatalogListingSystem, CatalogSystem } from '@core/systems';
import { CATALOG_PORTS } from '@creativo/infrastructure/firebase-app';

/**
 * Which of the landing's stored sections are drawn — the in-page anchors
 * (`/#services`, `/#team`, `/#visit`) the site menu and the footer link to.
 * The landing draws a section only with something stored to show
 * (`LandingContentService`'s `shows*`), so a link to one it hides would
 * lead nowhere.
 */
export interface SiteSections {
  /** The public shelf holds a service. */
  readonly services: boolean;
  /** A public barber is listed. */
  readonly team: boolean;
  /** An active shop is stored. */
  readonly visit: boolean;
}

/**
 * THE SHELL'S VIEW OF THE LANDING (2026-11-19) — the same three catalogue
 * reads the landing draws from (`CATALOG_PORTS`: the public barbers, the
 * active services, the active shops; the SDK shares one listen per query
 * with `CatalogContentService`), on the same rules: the public shelf is
 * `CatalogSystem.shelf` over `CatalogListingSystem.listedServices`. Every
 * answer is `false` until its read answers successfully, so an anchor never
 * appears only to vanish, and a failed read hides it like an empty one.
 *
 * Read once per session, from the first {@link sections} call on — the
 * header mounts the menu with the shell, so the reads start at shell mount,
 * long before the menu opens (the `ShopZoneService.defaultZone` precedent).
 */
@Injectable({ providedIn: 'root' })
export class SiteSectionsService {
  private readonly catalog = inject(CATALOG_PORTS);
  private readonly destroyRef = inject(DestroyRef);

  private readonly barbers = signal<readonly Barber[] | null>(null);
  private readonly services = signal<readonly Service[] | null>(null);
  private readonly shops = signal<readonly ShopLocation[] | null>(null);
  private reading = false;

  private readonly answer = computed<SiteSections>(() => {
    const barbers = this.barbers();
    const services = this.services();
    const shops = this.shops();
    return {
      services:
        barbers !== null &&
        services !== null &&
        CatalogSystem.shelf(
          CatalogListingSystem.listedServices(services, barbers),
        ).length > 0,
      team: barbers !== null && barbers.length > 0,
      visit: shops !== null && shops.length > 0,
    };
  });

  /** Which sections the landing draws — every one `false` until its read answers. */
  sections(): Signal<SiteSections> {
    this.read();
    return this.answer;
  }

  private read(): void {
    if (this.reading) return;
    this.reading = true;
    this.follow(this.catalog.observeBarbers(), this.barbers);
    this.follow(this.catalog.observeServices(), this.services);
    this.follow(this.catalog.observeLocations(), this.shops);
  }

  /** Keeps `target` on the stream's last good answer; a failure is `null` (unknown). */
  private follow<T, E>(
    stream: Observable<Result<readonly T[], E>>,
    target: WritableSignal<readonly T[] | null>,
  ): void {
    stream
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => target.set(result.ok ? result.value : null));
  }
}
