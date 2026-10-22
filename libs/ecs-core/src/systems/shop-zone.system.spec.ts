import { describe, expect, it } from 'vitest';
import { LocationId } from '@core/primitives';
import type { ShopLocation } from '@core/entities';
import { deepFreeze, FIXTURE_TIME_ZONE, locationFixture } from '@core/testing';
import { ShopZoneSystem } from './shop-zone.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The named → default rule `ProgramsSystem.zoneOf` held (its cases stay in
 * `programs.system.spec.ts`, now over this lifted rule), Phase 4a 4A-11.
 */
const zone = (raw: string) => {
  const checked = ZonedTimeSystem.checkZone(raw);
  if (!checked.ok) throw new Error(`fixture zone ${raw}`);
  return checked.value;
};

const at = (id: string, timeZone: string): ShopLocation =>
  locationFixture({ id: LocationId.of(id), timeZone: zone(timeZone) });

describe('ShopZoneSystem.zoneOf — the zone lives on the location only', () => {
  const mladost = at('loc-mladost', 'Europe/London');
  const center = at('loc-center', FIXTURE_TIME_ZONE);

  it('reads the named location first', () => {
    expect(ShopZoneSystem.zoneOf(mladost, center)).toBe('Europe/London');
  });

  it('falls back to the default location when none is named (or found)', () => {
    expect(ShopZoneSystem.zoneOf(null, center)).toBe(FIXTURE_TIME_ZONE);
  });

  it('is null when neither is stored', () => {
    expect(ShopZoneSystem.zoneOf(null, null)).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const named = deepFreeze(mladost);
    expect(ShopZoneSystem.zoneOf(named, null)).toBe(
      ShopZoneSystem.zoneOf(named, null),
    );
  });
});
