import {
  Injectable,
  type Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { LocationId, Result, TimeZone } from '@core/primitives';
import type { CatalogError, RepositoryError } from '@core/errors';
import { resolveShopZone } from '@core/pipelines';
import { DEFAULT_LOCATION_PORTS, LOCATION_LOAD_PORTS } from './ports.tokens';

/** What a zone read answers: the zone, or why there is none to read. */
export type ShopZoneAnswer = Result<
  TimeZone,
  RepositoryError | CatalogError.LocationZoneUnknown
>;

/**
 * THE WEB'S SHOP ZONE (Law 7.2; flatten-spec F-4, Phase 4a 4A-11) — the
 * one place a feature asks which IANA zone its wall clock is on, over the
 * one rule (`resolveShopZone`): a location in scope → its `timeZone`; none →
 * the deployment's default location's. No tenant-zone constant, no token.
 *
 * - {@link defaultZone} — the default location's zone, read ONCE per
 *   session (started on first read, cached), `null` until it resolves and
 *   when the read fails or no default location is stored: each surface
 *   folds that into its own loading / failed state (4A-2 (e), (f)).
 * - {@link defaultZoneFailed} — `true` once that read has failed (or found
 *   no default location), so a surface with a failed state can show it;
 *   {@link retryDefaultZone} reads again after a failure.
 * - {@link zoneOf} — one location's zone, read ONCE per location per
 *   session (OR-8): the answer is kept by `LocationId` — the default
 *   location's included, so the default read above is that location's
 *   entry — and two asks at once share the one read. A failed answer (a
 *   read that failed, no zone stored, a read that threw) is dropped as it
 *   lands, so the next ask reads again.
 * - {@link zonesOf} — several locations' zones at once, over the same
 *   memo, by location (each visit judged on its OWN shop's wall clock,
 *   OR-8): asked for `distinctLocationIds`, folded into each shop's "now"
 *   by `nowOfZones` (`shop-clocks.ts`).
 */
@Injectable({ providedIn: 'root' })
export class ShopZoneService {
  private readonly defaultLocation = inject(DEFAULT_LOCATION_PORTS);
  private readonly resolve = resolveShopZone({
    ...inject(LOCATION_LOAD_PORTS),
    ...this.defaultLocation,
  });
  /**
   * Each location's zone read, by location — kept for the session once it
   * answers a zone; dropped as soon as it answers a failure, so a failure
   * is never served twice.
   */
  private readonly zones = new Map<LocationId, Promise<ShopZoneAnswer>>();
  /** The default read's answer — `null` while none has been asked or answered. */
  private readonly defaultAnswer = signal<ShopZoneAnswer | null>(null);
  private readonly zone = computed<TimeZone | null>(() => {
    const answer = this.defaultAnswer();
    return answer !== null && answer.ok ? answer.value : null;
  });
  private readonly failed = computed<boolean>(() => {
    const answer = this.defaultAnswer();
    return answer !== null && !answer.ok;
  });
  private reading = false;

  /** The default location's zone — `null` until (and unless) it resolves. */
  defaultZone(): Signal<TimeZone | null> {
    this.readDefault();
    return this.zone;
  }

  /** `true` once the default location's zone could not be read (until a retry answers). */
  defaultZoneFailed(): Signal<boolean> {
    this.readDefault();
    return this.failed;
  }

  /** Reads the default location's zone again — only after a failed read; a resolved zone stays cached. */
  retryDefaultZone(): void {
    if (!this.failed()) return;
    this.defaultAnswer.set(null);
    this.reading = false;
    this.readDefault();
  }

  /** Starts the one read of the session, unless it is under way or answered. */
  private readDefault(): void {
    if (this.reading) return;
    this.reading = true;
    void this.readOnce(this.defaultLocation.defaultLocationId).then((answer) =>
      this.defaultAnswer.set(answer),
    );
  }

  /**
   * One location's zone (the default location's when it names none), read
   * once per location per session; a failed answer is not kept.
   */
  zoneOf(locationId: LocationId | null): Promise<ShopZoneAnswer> {
    return this.readOnce(locationId ?? this.defaultLocation.defaultLocationId);
  }

  /** The memo itself: the location's kept read, else a fresh one, kept unless it fails. */
  private readOnce(locationId: LocationId): Promise<ShopZoneAnswer> {
    const kept = this.zones.get(locationId);
    if (kept !== undefined) return kept;
    const read = this.resolve(locationId);
    this.zones.set(locationId, read);
    // Attached before any caller's own `then`, so a caller that hears the
    // failure already finds it gone: its retry reads again.
    const forget = (): void => {
      if (this.zones.get(locationId) === read) this.zones.delete(locationId);
    };
    void read.then((answer) => {
      if (!answer.ok) forget();
    }, forget);
    return read;
  }

  /**
   * Several locations' zones, by location — each through {@link zoneOf}'s
   * memo, so a location already answered costs no read. Rejects when any
   * read throws; a failed answer is that location's entry.
   */
  async zonesOf(
    locationIds: readonly LocationId[],
  ): Promise<ReadonlyMap<LocationId, ShopZoneAnswer>> {
    return new Map(
      await Promise.all(
        locationIds.map(
          async (locationId) =>
            [locationId, await this.zoneOf(locationId)] as const,
        ),
      ),
    );
  }
}
