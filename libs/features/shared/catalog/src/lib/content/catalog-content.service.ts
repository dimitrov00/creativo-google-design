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
  AUTH_SESSION_PORTS,
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { MediaRef, Principal, PrincipalKind } from '@core/components';
import type { MediaRefId, ServiceId } from '@core/primitives';
import type { Barber, Service, ShopLocation } from '@core/entities';
import { BARBER_ART, SERVICE_ART } from './catalog-art';
import { type BarberVm, type ServiceVm } from './catalog.vm';
import { barberToVm, serviceToVm } from './catalog.presenter';
import { mediaUrlCache } from './media-url-cache';

/**
 * The live catalog, with its media resolved — the one place a surface says
 * "give me the services and barbers, ready to render".
 *
 * Extracted when booking became the third consumer of the same ~50 lines
 * (landing, onboarding, booking): the live `CATALOG_PORTS` streams, a
 * `MediaRef` → URL cache that must not re-fetch on every snapshot re-emit,
 * and the mapping into view models. Three copies of that is three places
 * for the cache to drift.
 *
 * Root-provided: the URL cache is worth sharing across a navigation, and
 * the underlying reads are live snapshots the SDK already de-duplicates.
 */
@Injectable({ providedIn: 'root' })
export class CatalogContentService {
  private readonly catalog = inject(CATALOG_PORTS);

  /**
   * Resolved cover and avatar URLs, one resolve per media object — a
   * snapshot re-emit never re-fetches; a transient failure is retried with
   * backoff; a missing or forbidden object is asked about once (a
   * permanent `MediaError`), and a forbidden one again after the viewer
   * changes (see the constructor).
   *
   * THE session's one cache: the landing reads its view models from here
   * too, so a cover resolves once whichever surface asks first.
   */
  private readonly media = mediaUrlCache(inject(MEDIA_RESOLVE_PORTS));

  // The whole active catalogue: every category, every shop.
  private readonly servicesResult = toSignal(this.catalog.observeServices(), {
    initialValue: null,
  });

  private readonly barbersResult = toSignal(this.catalog.observeBarbers(), {
    initialValue: null,
  });

  private readonly locationsResult = toSignal(this.catalog.observeLocations(), {
    initialValue: null,
  });

  /** Active services as the stored entities — for conflict rules and terms. */
  readonly services = computed<readonly Service[]>(() => {
    const result = this.servicesResult();
    return result?.ok ? result.value : [];
  });

  readonly barbers = computed<readonly Barber[]>(() => {
    const result = this.barbersResult();
    return result?.ok ? result.value : [];
  });

  /**
   * Active shops. The booking flow needs them for their `openingHours` (the
   * outer envelope every slot is clamped to) and their `timeZone` — the
   * scheduling zone is the SHOP's, never the device's.
   */
  readonly locations = computed<readonly ShopLocation[]>(() => {
    const result = this.locationsResult();
    return result?.ok ? result.value : [];
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
  readonly servicesKnown = computed(() => this.servicesResult()?.ok === true);

  /**
   * The same for the barbers, which are a separate read: who is active is
   * known only once that read answers successfully. `loading` covers the
   * services only.
   */
  readonly barbersKnown = computed(() => this.barbersResult()?.ok === true);

  /**
   * The same for the shops, a third read. `locations()` is empty both while
   * the read is pending and after it fails, which is not "no active shop":
   * a consumer that decides from which shops are NOT on the list (a shop
   * that cannot serve somebody) waits for this one.
   */
  readonly locationsKnown = computed(() => this.locationsResult()?.ok === true);

  readonly serviceVms = computed<readonly ServiceVm[]>(() =>
    this.services().map((service) => this.toServiceVm(service)),
  );

  readonly barberVms = computed<readonly BarberVm[]>(() =>
    this.barbers().map((barber) =>
      barberToVm(
        barber,
        this.media.url(avatarRefOf(barber)),
        BARBER_ART[barber.id],
      ),
    ),
  );

  /** Every cover and avatar the catalogue names. */
  private readonly mediaRefs = computed<readonly MediaRef[]>(() => [
    ...this.services().flatMap((service) => {
      const cover = coverRefOf(service);
      return cover ? [cover] : [];
    }),
    ...this.barbers().flatMap((barber) => {
      const avatar = avatarRefOf(barber);
      return avatar ? [avatar] : [];
    }),
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
    // session (a test bed without one) means no viewer to change.
    inject(AUTH_SESSION_PORTS, { optional: true })
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
  coverUrl(serviceId: ServiceId): string | undefined {
    const service = this.findService(serviceId);
    return service ? this.coverUrlOf(service) : undefined;
  }

  /**
   * The resolved cover URL for a service already in hand, or `undefined`
   * while unknown: a lookup by its cover's path, never a search of the
   * catalogue — a grid that asks per card on every pass stays linear.
   */
  coverUrlOf(service: Service): string | undefined {
    return this.media.url(coverRefOf(service));
  }

  /**
   * Entity → view model, WITH the shared art direction applied.
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
      SERVICE_ART[service.id],
    );
  }

  findService(serviceId: ServiceId): Service | undefined {
    return this.services().find((service) => service.id === serviceId);
  }
}

/**
 * The cover as the media resolver reads it — the entity stores the seven
 * `coverMedia*` fields flat, all `null` together (N9); the `MediaRef` is
 * built at this one seam through its edge guard (`MediaRef.parse`, R9: a
 * malformed stored ref never reaches Storage). `null` when there is no
 * cover, or one the guard refuses — a placeholder, exactly as an unreadable
 * ref read before.
 */
function coverRefOf(service: Service): MediaRef | null {
  return mediaRefOf(
    service.coverMediaId,
    service.coverMediaPath,
    service.coverMediaWidth,
    service.coverMediaHeight,
    service.coverMediaBlurhash,
    service.coverMediaFocalX,
    service.coverMediaFocalY,
  );
}

/** The avatar as the media resolver reads it — {@link coverRefOf}'s seam, for `avatarMedia*`. */
function avatarRefOf(barber: Barber): MediaRef | null {
  return mediaRefOf(
    barber.avatarMediaId,
    barber.avatarMediaPath,
    barber.avatarMediaWidth,
    barber.avatarMediaHeight,
    barber.avatarMediaBlurhash,
    barber.avatarMediaFocalX,
    barber.avatarMediaFocalY,
  );
}

function mediaRefOf(
  id: MediaRefId | null,
  path: string | null,
  width: number | null,
  height: number | null,
  blurhash: string | null,
  focalX: number | null,
  focalY: number | null,
): MediaRef | null {
  if (id === null || path === null || width === null || height === null) {
    return null;
  }
  // Half a focal point is none, as the stored ref always read (not a refusal).
  const focused = focalX !== null && focalY !== null;
  const ref = MediaRef.parse({
    mediaId: id,
    mediaPath: path,
    mediaWidth: width,
    mediaHeight: height,
    mediaBlurhash: blurhash,
    mediaFocalX: focused ? focalX : null,
    mediaFocalY: focused ? focalY : null,
  });
  return ref.ok ? ref.value : null;
}

/**
 * Who is asking, as far as Storage's rules can tell: signed out, or an
 * account with its roles. A token refresh with the same claims is the same
 * viewer.
 */
function viewerOf(principal: Principal): string {
  if (principal.principalKind === PrincipalKind.Anonymous) return 'anonymous';
  if (!Principal.isActive(principal)) return `onboarding:${principal.userId}`;
  return `active:${principal.userId}:${[...principal.roles].sort().join(',')}`;
}
