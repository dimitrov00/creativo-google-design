import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocationId } from '@core/primitives';
import { deepFreeze, serviceFixture } from '@core/testing';
import { LocationScopeSystem } from './location-scope.system';

/*
 * The `locationScopeServes` cases of
 * libs/domain/catalog/src/lib/location.spec.ts (2), COPIED, plus the
 * `Service.servesLocation` convention the commit re-check relies on
 * (decide-booking.spec.ts: "empty means everywhere").
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

describe('LocationScopeSystem — services and parties', () => {
  it('reads a service entity straight from the catalogue', () => {
    const everywhere = serviceFixture({ locationIds: [] });
    const centreOnly = serviceFixture({ locationIds: [CENTER] });
    expect(LocationScopeSystem.servesLocation(everywhere, MLADOST)).toBe(true);
    expect(LocationScopeSystem.servesLocation(centreOnly, MLADOST)).toBe(false);
  });

  it('keeps only the shops that serve every entry, in the given order', () => {
    const party = [
      { locationIds: [MLADOST, CENTER] },
      { locationIds: [] },
      { locationIds: [CENTER] },
    ];
    expect(
      LocationScopeSystem.shopsServingAll([MLADOST, CENTER], party),
    ).toEqual([CENTER]);
    expect(LocationScopeSystem.allServe([], MLADOST)).toBe(true);
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
    const shops = deepFreeze([MLADOST, CENTER]);
    const party = deepFreeze([{ locationIds: [CENTER] }, { locationIds: [] }]);
    const once = LocationScopeSystem.shopsServingAll(shops, party);
    expect(LocationScopeSystem.shopsServingAll(shops, party)).toEqual(once);
    expect(shops).toEqual([MLADOST, CENTER]);
    expect(party).toEqual([{ locationIds: [CENTER] }, { locationIds: [] }]);
  });
});
