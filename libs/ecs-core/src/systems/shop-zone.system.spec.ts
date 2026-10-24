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

/*
 * Pass C, Y-5 / C-15 — the browser's two zone picks, moved out of
 * `staff-day.store.ts` (`writeBlocks`: the shop the block is written at,
 * else the page's zone; `zone`: the first listed shop, else the default
 * location's) and `booking-schedule-step.ts` (`timeZone`: the chosen shop,
 * else the first listed, else the default) — every precedence step.
 */
describe('ShopZoneSystem.zoneOr — a named location, else a zone already known', () => {
  const mladost = at('loc-mladost', 'Europe/London');

  it('reads the named location first', () => {
    expect(ShopZoneSystem.zoneOr(mladost, FIXTURE_TIME_ZONE)).toBe(
      'Europe/London',
    );
    expect(ShopZoneSystem.zoneOr(mladost, null)).toBe('Europe/London');
  });

  it('falls back to the zone when no location is named (or found)', () => {
    expect(ShopZoneSystem.zoneOr(null, FIXTURE_TIME_ZONE)).toBe(
      FIXTURE_TIME_ZONE,
    );
  });

  it('is null when neither is known — the caller refuses', () => {
    expect(ShopZoneSystem.zoneOr(null, null)).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const named = deepFreeze(mladost);
    expect(ShopZoneSystem.zoneOr(named, null)).toBe(
      ShopZoneSystem.zoneOr(named, null),
    );
    expect(named.timeZone).toBe('Europe/London');
  });
});

describe('ShopZoneSystem.zoneOfScope — chosen ▸ first listed ▸ default', () => {
  const chosen = at('loc-mladost', 'Europe/London');
  const first = at('loc-center', FIXTURE_TIME_ZONE);
  const fallback = zone('Europe/Paris');

  it('reads the chosen location first', () => {
    expect(ShopZoneSystem.zoneOfScope(chosen, first, fallback)).toBe(
      'Europe/London',
    );
    expect(ShopZoneSystem.zoneOfScope(chosen, null, null)).toBe(
      'Europe/London',
    );
  });

  it('under no choice, the first listed location', () => {
    expect(ShopZoneSystem.zoneOfScope(null, first, fallback)).toBe(
      FIXTURE_TIME_ZONE,
    );
    expect(ShopZoneSystem.zoneOfScope(null, first, null)).toBe(
      FIXTURE_TIME_ZONE,
    );
  });

  it('before the catalogue lists any, the default location’s zone', () => {
    expect(ShopZoneSystem.zoneOfScope(null, null, fallback)).toBe(
      'Europe/Paris',
    );
  });

  it('is null until one of them is known', () => {
    expect(ShopZoneSystem.zoneOfScope(null, null, null)).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const named = deepFreeze(chosen);
    const listed = deepFreeze(first);
    expect(ShopZoneSystem.zoneOfScope(null, listed, fallback)).toBe(
      ShopZoneSystem.zoneOfScope(null, listed, fallback),
    );
    expect(ShopZoneSystem.zoneOfScope(named, listed, null)).toBe(
      'Europe/London',
    );
    expect(listed.timeZone).toBe(FIXTURE_TIME_ZONE);
  });
});
