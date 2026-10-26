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
 * own failed state); a location's own zone on demand, read once per
 * location and never kept when it failed (OR-8).
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

  it('reads a location’s zone once — a second ask does no read, and two asks at once share the one read (OR-8)', async () => {
    const { service, reads } = setup((id) => Result.ok(stored(id)));
    const [first, second] = await Promise.all([
      service.zoneOf(MLADOST),
      service.zoneOf(MLADOST),
    ]);
    expect(first).toEqual(Result.ok(LONDON));
    expect(second).toEqual(Result.ok(LONDON));
    expect(reads).toEqual([MLADOST]);

    expect(await service.zoneOf(MLADOST)).toEqual(Result.ok(LONDON));
    expect(reads).toEqual([MLADOST]);
  });

  it('keeps no failed answer — the next ask reads again, and a zone once read is then kept (OR-8)', async () => {
    let up = false;
    const { service, reads } = setup((id) =>
      up
        ? Result.ok(stored(id))
        : Result.err(
            RepositoryError.readFailed('locations/loc-mladost', 'down'),
          ),
    );
    expect((await service.zoneOf(MLADOST)).ok).toBe(false);

    up = true;
    expect(await service.zoneOf(MLADOST)).toEqual(Result.ok(LONDON));
    expect(await service.zoneOf(MLADOST)).toEqual(Result.ok(LONDON));
    expect(reads).toEqual([MLADOST, MLADOST]);
  });

  it('keeps no refusal either — a location with no zone stored is asked again', async () => {
    let seeded = false;
    const { service } = setup((id) => Result.ok(seeded ? stored(id) : null));
    const refused = await service.zoneOf(MLADOST);
    expect(!refused.ok && refused.error.errorCode).toBe(
      CatalogErrorCode.LocationZoneUnknown,
    );
    seeded = true;
    expect(await service.zoneOf(MLADOST)).toEqual(Result.ok(LONDON));
  });

  it('keeps no read that threw — the next ask reads again', async () => {
    let calls = 0;
    const { service } = setup((id) => {
      calls += 1;
      if (calls === 1) throw new Error('socket closed');
      return Result.ok(stored(id));
    });
    await expect(service.zoneOf(MLADOST)).rejects.toThrow('socket closed');
    expect(await service.zoneOf(MLADOST)).toEqual(Result.ok(LONDON));
  });

  it('keeps the default location’s zone as that location’s entry — the default read and a visit at that shop cost one read', async () => {
    const { service, reads } = setup((id) => Result.ok(stored(id)));
    service.defaultZone();
    await settle();
    expect(await service.zoneOf(CENTER)).toEqual(Result.ok(FIXTURE_TIME_ZONE));
    expect(await service.zoneOf(null)).toEqual(Result.ok(FIXTURE_TIME_ZONE));
    expect(reads).toEqual([CENTER]);
  });

  it('answers several locations’ zones by location, over the same memo', async () => {
    const { service, reads } = setup((id) => Result.ok(stored(id)));
    await service.zoneOf(CENTER);

    const zones = await service.zonesOf([CENTER, MLADOST]);
    expect([...zones]).toEqual([
      [CENTER, Result.ok(FIXTURE_TIME_ZONE)],
      [MLADOST, Result.ok(LONDON)],
    ]);
    expect(reads).toEqual([CENTER, MLADOST]);
    expect((await service.zonesOf([])).size).toBe(0);
  });
});
