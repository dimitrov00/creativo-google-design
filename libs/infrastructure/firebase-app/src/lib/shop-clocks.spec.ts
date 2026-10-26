import { describe, expect, it } from 'vitest';
import { LocationId, Result } from '@core/primitives';
import { CatalogError, RepositoryError } from '@core/errors';
import { ZonedTimeSystem } from '@core/systems';
import { FIXTURE_TIME_ZONE, utcMs } from '@core/testing';
import {
  distinctLocationIds,
  nowOfZones,
  sameLocationIds,
} from './shop-clocks';
import type { ShopZoneAnswer } from './shop-zone.service';

/*
 * Each visit on its own shop's clock (OR-8) — the shared pieces the menu,
 * `/account` and `/account/appointments` judge their visits with: the
 * shops a set of visits is at, the equality of two such lists, and the
 * per-shop "now" folded from the zone answers.
 */
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const LOZENETS = LocationId.of('loc-lozenets');
const LONDON = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/London');
  if (!zone.ok) throw new Error('fixture zone');
  return zone.value;
})();
// 06:00 UTC on 2026-09-28: 09:00 in Sofia (+03:00), 07:00 in London (+01:00).
const AT = utcMs('2026-09-28T06:00:00Z');

describe('distinctLocationIds', () => {
  it('lists each shop once, in code-unit order, whatever the input order', () => {
    const visits = [
      { locationId: MLADOST },
      { locationId: CENTER },
      { locationId: MLADOST },
      { locationId: LOZENETS },
    ];
    expect(distinctLocationIds(visits)).toEqual([CENTER, LOZENETS, MLADOST]);
    expect(distinctLocationIds([...visits].reverse())).toEqual([
      CENTER,
      LOZENETS,
      MLADOST,
    ]);
  });

  it('reads any iterable of items carrying a shop, and nothing for nothing', () => {
    expect(
      distinctLocationIds(new Set([{ locationId: CENTER, extra: 1 }])),
    ).toEqual([CENTER]);
    expect(distinctLocationIds([])).toEqual([]);
  });
});

describe('sameLocationIds', () => {
  it('holds for the same ids in the same order, and for one list itself', () => {
    const ids = [CENTER, MLADOST];
    expect(sameLocationIds(ids, ids)).toBe(true);
    expect(sameLocationIds(ids, [CENTER, MLADOST])).toBe(true);
    expect(sameLocationIds([], [])).toBe(true);
  });

  it('fails for another order, another length, or another id', () => {
    expect(sameLocationIds([CENTER, MLADOST], [MLADOST, CENTER])).toBe(false);
    expect(sameLocationIds([CENTER], [CENTER, MLADOST])).toBe(false);
    expect(sameLocationIds([CENTER], [LOZENETS])).toBe(false);
  });

  it('equals no list to none, and none to none', () => {
    expect(sameLocationIds(undefined, undefined)).toBe(true);
    expect(sameLocationIds(undefined, [])).toBe(false);
    expect(sameLocationIds([CENTER], undefined)).toBe(false);
  });
});

describe('nowOfZones', () => {
  const answers = new Map<LocationId, ShopZoneAnswer>([
    [CENTER, Result.ok(FIXTURE_TIME_ZONE)],
    [MLADOST, Result.ok(LONDON)],
    [
      LOZENETS,
      Result.err(RepositoryError.readFailed('locations/loc-lozenets', 'down')),
    ],
  ]);

  it('reads "now" on each shop’s own wall clock', () => {
    const nowOf = nowOfZones(answers, AT);
    expect(nowOf(CENTER)).toEqual(
      ZonedTimeSystem.shopNow(AT, FIXTURE_TIME_ZONE),
    );
    expect(nowOf(CENTER)?.currentMinute).toBe(540);
    expect(nowOf(MLADOST)?.currentMinute).toBe(420);
    expect(nowOf(MLADOST)?.utcEpochMs).toBe(AT);
  });

  it('knows no clock for a shop whose zone failed, for a shop not asked, and for any while the answers are on their way', () => {
    const refused = new Map<LocationId, ShopZoneAnswer>([
      [CENTER, Result.err(CatalogError.locationZoneUnknown(CENTER))],
    ]);
    expect(nowOfZones(answers, AT)(LOZENETS)).toBeNull();
    expect(nowOfZones(answers, AT)(LocationId.of('loc-gone'))).toBeNull();
    expect(nowOfZones(refused, AT)(CENTER)).toBeNull();
    expect(nowOfZones(null, AT)(CENTER)).toBeNull();
  });

  it('leaves the answers as they were', () => {
    nowOfZones(answers, AT);
    expect([...answers.keys()]).toEqual([CENTER, MLADOST, LOZENETS]);
  });
});
