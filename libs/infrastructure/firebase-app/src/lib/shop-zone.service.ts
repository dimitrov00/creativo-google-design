import {
  Injectable,
  type Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {
  CatalogError,
  LocationId,
  RepositoryError,
  Result,
  TimeZone,
} from '@core/primitives';
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
 * - {@link zoneOf} — one location's zone, each call a fresh read.
 */
@Injectable({ providedIn: 'root' })
export class ShopZoneService {
  private readonly resolve = resolveShopZone({
    ...inject(LOCATION_LOAD_PORTS),
    ...inject(DEFAULT_LOCATION_PORTS),
  });
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
    void this.resolve(null).then((answer) => this.defaultAnswer.set(answer));
  }

  /** One location's zone (the default location's when it names none). */
  zoneOf(locationId: LocationId | null): Promise<ShopZoneAnswer> {
    return this.resolve(locationId);
  }
}
