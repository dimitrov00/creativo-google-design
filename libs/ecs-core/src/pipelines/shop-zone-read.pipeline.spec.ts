import { describe, expect, it } from 'vitest';
import { LocationId, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  FIXTURE_TIME_ZONE,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
} from '@core/testing';
import { readShopZone } from './shop-zone-read.pipeline';

/*
 * The server's zone read (Phase 4a 4A-11, 4A-2 (e)): `resolveShopZone`'s
 * answer, its refusal folded into the store failure every server boundary
 * already answers — never a second rule for which location's zone it is
 * (that is `resolve-shop-zone.pipeline.spec.ts`'s).
 */

const CENTRE = LocationId.of('loc-center');

function read(locations: readonly ReturnType<typeof locationFixture>[]) {
  return readShopZone({
    ...memoryLocationLoadPorts(memoryProgramsWorld({ locations })),
    ...memoryDefaultLocationPorts(CENTRE),
  });
}

describe('readShopZone', () => {
  it('answers the zone resolveShopZone answers — the named shop’s, else the default one’s', async () => {
    expect(await read([locationFixture()])(null)).toEqual(
      Result.ok(FIXTURE_TIME_ZONE),
    );
    expect(await read([locationFixture()])(LocationId.of('loc-gone'))).toEqual(
      Result.ok(FIXTURE_TIME_ZONE),
    );
  });

  it('answers neither location stored as a read failure on the default location, the refusal’s code its reason', async () => {
    expect(await read([])(null)).toEqual(
      Result.err(
        RepositoryError.readFailed(
          'locations/loc-center',
          'CATALOG_LOCATION_ZONE_UNKNOWN',
        ),
      ),
    );
  });

  it('answers a read that fails with its own repository error', async () => {
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const run = readShopZone({
      loadLocation: async () => Result.err(failed),
      ...memoryDefaultLocationPorts(CENTRE),
    });
    expect(await run(null)).toEqual(Result.err(failed));
  });
});
