import { describe, expect, it } from 'vitest';
import {
  CatalogErrorCode,
  LocationId,
  RepositoryError,
  Result,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
} from '@core/testing';
import { resolveShopZone } from './resolve-shop-zone.pipeline';

/*
 * The zone lives on the location only (Law 7.2; F-4, Phase 4a 4A-11): the
 * named location's zone, else the default location's; neither stored is
 * `CATALOG_LOCATION_ZONE_UNKNOWN`; a read that fails is its own repository
 * error — each boundary's existing store-failure outcome (4A-2 (e)).
 */
const LONDON = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/London');
  if (!zone.ok) throw new Error('fixture zone');
  return zone.value;
})();
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');

function rig(locations: readonly ReturnType<typeof locationFixture>[]) {
  const world = memoryProgramsWorld({ locations });
  return resolveShopZone({
    ...memoryLocationLoadPorts(world),
    ...memoryDefaultLocationPorts(CENTER),
  });
}

describe('resolveShopZone', () => {
  const center = locationFixture({ id: CENTER });
  const mladost = locationFixture({ id: MLADOST, timeZone: LONDON });

  it('answers the named location’s zone', async () => {
    expect(await rig([center, mladost])(MLADOST)).toEqual(Result.ok(LONDON));
  });

  it('falls back to the default location when the named one is absent', async () => {
    expect(await rig([center])(MLADOST)).toEqual(Result.ok(FIXTURE_TIME_ZONE));
  });

  it('reads the default location when none is named', async () => {
    expect(await rig([center, mladost])(null)).toEqual(
      Result.ok(FIXTURE_TIME_ZONE),
    );
  });

  it('refuses when neither is stored', async () => {
    expect(await rig([])(MLADOST)).toEqual({
      ok: false,
      error: {
        errorCode: CatalogErrorCode.LocationZoneUnknown,
        locationId: CENTER,
      },
    });
  });

  it('answers a read that fails with its repository error', async () => {
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const run = resolveShopZone({
      loadLocation: async () => Result.err(failed),
      ...memoryDefaultLocationPorts(CENTER),
    });
    expect(await run(null)).toEqual(Result.err(failed));
    expect(await run(MLADOST)).toEqual(Result.err(failed));
  });
});
