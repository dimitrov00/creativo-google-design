import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map, skip } from 'rxjs';
import {
  Barber,
  CATALOG_READER,
  Location,
  MEDIA_READER,
  MediaRef,
  Service,
} from '@creativo/application/catalog';
import { AUTH_GATEWAY, type Principal } from '@creativo/application/identity';
import { BARBER_ART, SERVICE_ART } from './catalog-art';
import { type BarberVm, type ServiceVm } from './catalog-vm';
import { barberToVm, serviceToVm } from './catalog-to-vm';
import { MediaUrlCache } from './media-url-cache';

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

  /**
   * Resolved cover and avatar URLs, one resolve per media object — a
   * snapshot re-emit never re-fetches; a transient failure is retried with
   * backoff; a missing or forbidden object is asked about once
   * (`MediaUnavailableError`), and a forbidden one again after the viewer
   * changes (see the constructor).
   *
   * THE session's one cache: the landing reads its view models from here
   * too, so a cover resolves once whichever surface asks first.
   */
  private readonly media = new MediaUrlCache(inject(MEDIA_READER));

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
   * True once the services read has answered SUCCESSFULLY.
   *
   * Not `!loading()`: a failed read also ends the loading, and renders as an
   * empty list. A consumer that decides from what is NOT on the list (a
   * retired service) must wait for this one, or it reads "retired" off a
   * list that never arrived.
   */
  readonly servicesKnown = computed(
    () => this.servicesResult()?.isSuccess() === true,
  );

  /**
   * The same for the barbers, which are a separate read: who is active is
   * known only once that read answers successfully. `loading` covers the
   * services only.
   */
  readonly barbersKnown = computed(
    () => this.barbersResult()?.isSuccess() === true,
  );

  /**
   * The same for the shops, a third read. `locations()` is empty both while
   * the read is pending and after it fails, which is not "no active shop":
   * a consumer that decides from which shops are NOT on the list (a shop
   * that cannot serve somebody) waits for this one.
   */
  readonly locationsKnown = computed(
    () => this.locationsResult()?.isSuccess() === true,
  );

  readonly serviceVms = computed<readonly ServiceVm[]>(() =>
    this.services().map((service) => this.toServiceVm(service)),
  );

  readonly barberVms = computed<readonly BarberVm[]>(() =>
    this.barbers().map((barber) =>
      barberToVm(
        barber,
        this.media.url(barber.avatar),
        BARBER_ART[barber.id.value],
      ),
    ),
  );

  /** Every cover and avatar the catalogue names. */
  private readonly mediaRefs = computed<readonly MediaRef[]>(() => [
    ...this.services().flatMap((service) =>
      service.cover ? [service.cover] : [],
    ),
    ...this.barbers().flatMap((barber) =>
      barber.avatar ? [barber.avatar] : [],
    ),
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.media.dispose());
    effect(() => {
      const refs = this.mediaRefs();
      // Tracks the catalogue only; the cache's own bookkeeping is not a
      // dependency of this effect.
      untracked(() => this.media.request(refs));
    });
    // A new viewer — a sign-in, a sign-out, a change of roles — may read
    // what Storage's rules refused the last one: the cache forgets its
    // forbidden answers and the catalogue's media are asked for again. The
    // FIRST viewer is not a change: Storage waits for Auth to restore the
    // session before it asks, so the first answers were already its. No
    // gateway (a test bed without one) means no viewer to change.
    inject(AUTH_GATEWAY, { optional: true })
      ?.observePrincipal()
      .pipe(
        map(viewerOf),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.media.identityChanged();
        this.media.request(this.mediaRefs());
      });
  }

  /**
   * The resolved cover URL for one service, or `undefined` while unknown —
   * by id, for a caller that holds only the id. One that holds the
   * `Service` asks {@link coverUrlOf}, which does not search the list.
   */
  coverUrl(serviceId: string): string | undefined {
    const service = this.findService(serviceId);
    return service ? this.coverUrlOf(service) : undefined;
  }

  /**
   * The resolved cover URL for a service already in hand, or `undefined`
   * while unknown: a lookup by its cover's path, never a search of the
   * catalogue — a grid that asks per card on every pass stays linear.
   */
  coverUrlOf(service: Service): string | undefined {
    return this.media.url(service.cover);
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
      this.coverUrlOf(service),
      SERVICE_ART[service.id.value],
    );
  }

  findService(serviceId: string): Service | undefined {
    return this.services().find((service) => service.id.value === serviceId);
  }
}

/**
 * Who is asking, as far as Storage's rules can tell: signed out, or a uid
 * with its roles. A token refresh with the same claims is the same viewer.
 */
function viewerOf(principal: Principal): string {
  switch (principal.kind) {
    case 'anonymous':
      return 'anonymous';
    case 'onboarding':
      return `onboarding:${principal.uid.value}`;
    case 'active':
      return `active:${principal.uid.value}:${[...principal.roles].sort().join(',')}`;
  }
}
