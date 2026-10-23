import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { ShopLocation } from '@core/entities';
import { LocationId, Result } from '@core/primitives';
import { CatalogErrorCode, RepositoryError } from '@core/errors';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  locationFixture,
  memoryDefaultLocationPorts,
} from '@core/testing';
import { DEFAULT_LOCATION_PORTS, LOCATION_LOAD_PORTS } from './ports.tokens';
import { ShopZoneService } from './shop-zone.service';

/*
 * The web's one zone read (Phase 4a 4A-11): the default location's zone
 * ONCE per session, cached; a failed read leaves it `null` (each surface's
 * own failed state); a location's own zone on demand.
 */
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const LONDON = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/London');
  if (!zone.ok) throw new Error('fixture zone');
  return zone.value;
})();

function setup(
  load: (id: LocationId) => Result<ShopLocation | null, RepositoryError>,
) {
  const reads: LocationId[] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: {
          loadLocation: async (id: LocationId) => {
            reads.push(id);
            return load(id);
          },
        },
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(CENTER),
      },
    ],
  });
  return { service: TestBed.inject(ShopZoneService), reads };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ShopZoneService', () => {
  const center = locationFixture({ id: CENTER });
  const mladost = locationFixture({ id: MLADOST, timeZone: LONDON });
  /** The two stored locations, by id — `null` for any other. */
  const stored = (id: LocationId): ShopLocation | null =>
    id === CENTER ? center : id === MLADOST ? mladost : null;

  it('reads the default location’s zone once per session, null until it resolves', async () => {
    const { service, reads } = setup((id) => Result.ok(stored(id)));
    const zone = service.defaultZone();
    expect(zone()).toBeNull();
    await settle();
    expect(zone()).toBe(FIXTURE_TIME_ZONE);
    service.defaultZone();
    service.defaultZone();
    await settle();
    expect(reads).toEqual([CENTER]);
  });

  it('stays null when the read fails — the surface’s own failed state', async () => {
    const { service } = setup(() =>
      Result.err(RepositoryError.readFailed('locations/loc-center', 'down')),
    );
    const zone = service.defaultZone();
    await settle();
    expect(zone()).toBeNull();
  });

  it('says when the default read failed, and reads again only on a retry after a failure', async () => {
    let up = false;
    const { service, reads } = setup((id) =>
      up
        ? Result.ok(stored(id))
        : Result.err(
            RepositoryError.readFailed('locations/loc-center', 'down'),
          ),
    );
    const failed = service.defaultZoneFailed();
    const zone = service.defaultZone();
    expect(failed()).toBe(false);
    await settle();
    expect(failed()).toBe(true);
    expect(zone()).toBeNull();
    up = true;
    service.retryDefaultZone();
    expect(failed()).toBe(false);
    await settle();
    expect(zone()).toBe(FIXTURE_TIME_ZONE);
    expect(failed()).toBe(false);
    service.retryDefaultZone();
    await settle();
    expect(reads).toEqual([CENTER, CENTER]);
  });

  it('counts no default location stored as a failed read', async () => {
    const { service } = setup(() => Result.ok(null));
    const failed = service.defaultZoneFailed();
    await settle();
    expect(failed()).toBe(true);
    expect(service.defaultZone()()).toBeNull();
  });

  it('answers a location’s own zone, else the default’s, else the refusal', async () => {
    const { service } = setup((id) => Result.ok(stored(id)));
    expect(await service.zoneOf(MLADOST)).toEqual(Result.ok(LONDON));
    expect(await service.zoneOf(null)).toEqual(Result.ok(FIXTURE_TIME_ZONE));
    const empty = setup(() => Result.ok(null));
    const refused = await empty.service.zoneOf(MLADOST);
    expect(!refused.ok && refused.error.errorCode).toBe(
      CatalogErrorCode.LocationZoneUnknown,
    );
  });
});
