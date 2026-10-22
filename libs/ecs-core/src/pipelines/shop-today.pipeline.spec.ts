import { describe, expect, it } from 'vitest';
import type { ShopLocation } from '@core/entities';
import {
  CatalogErrorCode,
  LocationId,
  RepositoryError,
  RepositoryErrorCode,
  Result,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  locationFixture,
  memoryDefaultLocationPorts,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { shopToday } from './shop-today.pipeline';

/*
 * The shop's day where no location is in scope — the loyalty catalogue's
 * memo key (4A-11): the clock on every call, the default location's zone
 * read ONCE (`readShopZone`) and kept; a failed zone read is the boundary's
 * own store failure (4A-2 (e)) and is not kept.
 */
const CENTER = LocationId.of('loc-center');
const LONDON = unwrapOk(ZonedTimeSystem.checkZone('Europe/London'));

/** 23:30 in Sofia on 28.09 is still 21:30 in London — the zone decides the day. */
const SOFIA_LATE = utcMs('2026-09-28T23:30:00.000+03:00');

function setUp(
  load: (id: LocationId) => Result<ShopLocation | null, RepositoryError>,
  start = SOFIA_LATE,
) {
  const reads: LocationId[] = [];
  let now = start;
  const today = shopToday({
    nowUtcMs: () => now,
    loadLocation: async (id) => {
      reads.push(id);
      return load(id);
    },
    ...memoryDefaultLocationPorts(CENTER),
  });
  return {
    today,
    reads,
    moveTo: (next: typeof now) => {
      now = next;
    },
  };
}

describe('shopToday', () => {
  const center = locationFixture({ id: CENTER });

  it('reads the clock on the default location’s wall clock', async () => {
    const { today } = setUp(() => Result.ok(center));

    expect(unwrapOk(await today())).toBe('2026-09-28');
  });

  it('places the instant on the stored zone, never a constant', async () => {
    const { today } = setUp(() =>
      Result.ok(locationFixture({ id: CENTER, timeZone: LONDON })),
    );

    expect(unwrapOk(await today())).toBe('2026-09-28');
    const sofiaAfterMidnight = setUp(
      () => Result.ok(center),
      utcMs('2026-09-29T00:30:00.000+03:00'),
    );
    const londonStillBefore = setUp(
      () => Result.ok(locationFixture({ id: CENTER, timeZone: LONDON })),
      utcMs('2026-09-29T00:30:00.000+03:00'),
    );
    expect(unwrapOk(await sofiaAfterMidnight.today())).toBe('2026-09-29');
    expect(unwrapOk(await londonStillBefore.today())).toBe('2026-09-28');
  });

  it('reads the zone once for the session, the clock on every call — a tab left open past midnight turns the day', async () => {
    const { today, reads, moveTo } = setUp(() => Result.ok(center));

    expect(unwrapOk(await today())).toBe('2026-09-28');
    moveTo(utcMs('2026-09-29T00:10:00.000+03:00'));
    expect(unwrapOk(await today())).toBe('2026-09-29');

    expect(reads).toEqual([CENTER]);
  });

  it('shares one zone read between callers asking at once', async () => {
    const { today, reads } = setUp(() => Result.ok(center));

    const [first, second] = await Promise.all([today(), today()]);

    expect(unwrapOk(first)).toBe(unwrapOk(second));
    expect(reads).toEqual([CENTER]);
  });

  it('answers a failed zone read with its RepositoryError, and reads again next call', async () => {
    let down = true;
    const failure = RepositoryError.readFailed('locations/loc-center', 'down');
    const { today, reads } = setUp(() =>
      down ? Result.err(failure) : Result.ok(center),
    );

    expect(unwrapErr(await today())).toEqual(failure);
    down = false;
    expect(unwrapOk(await today())).toBe('2026-09-28');
    expect(reads).toEqual([CENTER, CENTER]);
  });

  it('answers no stored default location as a failed read of it — the catalogue’s own store failure', async () => {
    const { today } = setUp(() => Result.ok(null));

    expect(unwrapErr(await today())).toEqual({
      errorCode: RepositoryErrorCode.ReadFailed,
      path: 'locations/loc-center',
      reason: CatalogErrorCode.LocationZoneUnknown,
    });
  });
});
