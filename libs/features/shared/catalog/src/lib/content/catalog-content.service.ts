import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Barber,
  CATALOG_READER,
  Location,
  MEDIA_READER,
  MediaRef,
  Service,
} from '@creativo/application/catalog';
import { BARBER_ART, SERVICE_ART } from './catalog-art';
import { type BarberVm, type ServiceVm } from './catalog-vm';
import { barberToVm, serviceToVm } from './catalog-to-vm';

/**
 * The live catalog, with its media resolved — the one place a surface says
 * "give me the services and barbers, ready to render".
 *
 * Extracted when booking became the third consumer of the same ~50 lines
 * (landing, onboarding, booking): two live `CatalogReader` subscriptions, a
 * `MediaRef` → URL cache that must not re-fetch on every snapshot re-emit,
 * and the mapping into view models. Three copies of that is three places
 * for the cache to drift.
 *
 * Root-provided: the URL cache is worth sharing across a navigation, and
 * the underlying reads are live snapshots the SDK already de-duplicates.
 */
@Injectable({ providedIn: 'root' })
export class CatalogContentService {
  private readonly catalogReader = inject(CATALOG_READER);
  private readonly mediaReader = inject(MEDIA_READER);

  private readonly servicesResult = toSignal(
    this.catalogReader.listActiveServices(),
    { initialValue: null },
  );

  private readonly barbersResult = toSignal(
    this.catalogReader.listActiveBarbers(),
    { initialValue: null },
  );

  private readonly locationsResult = toSignal(
    this.catalogReader.listActiveLocations(),
    { initialValue: null },
  );

  /** Active services as domain aggregates — for conflict rules and terms. */
  readonly services = computed<readonly Service[]>(() => {
    const result = this.servicesResult();
    return result?.isSuccess() ? result.value : [];
  });

  readonly barbers = computed<readonly Barber[]>(() => {
    const result = this.barbersResult();
    return result?.isSuccess() ? result.value : [];
  });

  /**
   * Active shops. The booking flow needs them for their `hours` (the outer
   * envelope every slot is clamped to) and their `timezone` — the scheduling
   * zone is the SHOP's, never the device's.
   */
  readonly locations = computed<readonly Location[]>(() => {
    const result = this.locationsResult();
    return result?.isSuccess() ? result.value : [];
  });

  /** True until the first answer lands — lets consumers tell empty from loading. */
  readonly loading = computed(() => this.servicesResult() === null);

  /**
   * Resolved media URLs, keyed by service id for covers and by `MediaRef`
   * id for barber avatars. The two namespaces are each unique and never
   * collide.
   */
  private readonly urls = signal<Readonly<Record<string, string>>>({});

  /** Keys with a resolve already in flight — a snapshot re-emit must not re-fetch. */
  private readonly requested = new Set<string>();

  readonly serviceVms = computed<readonly ServiceVm[]>(() =>
    this.services().map((service) => this.toServiceVm(service)),
  );

  readonly barberVms = computed<readonly BarberVm[]>(() =>
    this.barbers().map((barber) =>
      barberToVm(
        barber,
        barber.avatar ? this.urls()[barber.avatar.id.value] : undefined,
        // eslint-disable-next-line security/detect-object-injection -- catalog ids.
        BARBER_ART[barber.id.value],
      ),
    ),
  );

  constructor() {
    effect(() => {
      const refs: { readonly key: string; readonly ref: MediaRef }[] = [
        ...this.services().flatMap((service) =>
          service.cover ? [{ key: service.id.value, ref: service.cover }] : [],
        ),
        ...this.barbers().flatMap((barber) =>
          barber.avatar
            ? [{ key: barber.avatar.id.value, ref: barber.avatar }]
            : [],
        ),
      ];

      for (const { key, ref } of refs) {
        if (this.requested.has(key)) continue;
        this.requested.add(key);
        void this.mediaReader.resolve(ref).then((result) => {
          if (result.isFailure()) return;
          const [variant] = result.value;
          if (!variant) return;
          this.urls.update((urls) => ({ ...urls, [key]: variant.url }));
        });
      }
    });
  }

  /** The resolved cover URL for one service, or `undefined` while in flight. */
  coverUrl(serviceId: string): string | undefined {
    return this.urls()[serviceId];
  }

  /**
   * Domain → view model, WITH the shared art direction applied.
   *
   * Passing `undefined` here is what made `/book` render the shared detail
   * sheet with an empty gallery: the sheet was reused, the editorial data it
   * needs was not, and the drift surfaced as a silently missing media section
   * rather than an error. One source, every surface.
   */
  toServiceVm(service: Service): ServiceVm {
    return serviceToVm(
      service,
      this.urls()[service.id.value],
      // eslint-disable-next-line security/detect-object-injection -- catalog ids.
      SERVICE_ART[service.id.value],
    );
  }

  findService(serviceId: string): Service | undefined {
    return this.services().find((service) => service.id.value === serviceId);
  }
}
