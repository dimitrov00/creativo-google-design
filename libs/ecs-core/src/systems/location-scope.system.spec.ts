import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocationId } from '@core/primitives';
import { deepFreeze, serviceFixture } from '@core/testing';
import { LocationScopeSystem } from './location-scope.system';

/*
 * The `locationScopeServes` cases of the legacy catalog `location.spec.ts` (2;
 * deleted in Phase 4b, ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), COPIED, plus the `Service.servesLocation` convention the commit
 * re-check relies on (decide-booking.spec.ts: "empty means everywhere").
 */

const CENTER = LocationId.of('center');
const MLADOST = LocationId.of('mladost');

describe('LocationScopeSystem.serves', () => {
  it('treats an empty locationIds as "available everywhere"', () => {
    expect(LocationScopeSystem.serves([], CENTER)).toBe(true);
    expect(LocationScopeSystem.serves([], MLADOST)).toBe(true);
  });

  it('matches only the listed locations when scoped', () => {
    expect(LocationScopeSystem.serves([CENTER], CENTER)).toBe(true);
    expect(LocationScopeSystem.serves([CENTER], MLADOST)).toBe(false);
  });
});

describe('LocationScopeSystem — catalogue entries', () => {
  it('reads a service entity straight from the catalogue', () => {
    const everywhere = serviceFixture({ locationIds: [] });
    const centreOnly = serviceFixture({ locationIds: [CENTER] });
    expect(LocationScopeSystem.servesLocation(everywhere, MLADOST)).toBe(true);
    expect(LocationScopeSystem.servesLocation(centreOnly, MLADOST)).toBe(false);
  });

  it('agrees with "empty or listed" for any scope (property)', () => {
    const anyShop = fc.constantFrom(CENTER, MLADOST, LocationId.of('lozenets'));
    fc.assert(
      fc.property(fc.array(anyShop, { maxLength: 3 }), anyShop, (scope, at) => {
        expect(LocationScopeSystem.serves(scope, at)).toBe(
          scope.length === 0 || scope.some((id) => id === at),
        );
      }),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const scope = deepFreeze([MLADOST, CENTER]);
    const entry = deepFreeze({ locationIds: [CENTER] });
    const once = LocationScopeSystem.servesLocation(entry, MLADOST);
    expect(LocationScopeSystem.servesLocation(entry, MLADOST)).toBe(once);
    expect(LocationScopeSystem.serves(scope, CENTER)).toBe(true);
    expect(scope).toEqual([MLADOST, CENTER]);
    expect(entry).toEqual({ locationIds: [CENTER] });
  });
});
