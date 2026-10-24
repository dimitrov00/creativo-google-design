import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocationId } from '@core/primitives';
import { barberFixture, deepFreeze, serviceFixture } from '@core/testing';
import { LocationScopeSystem } from './location-scope.system';

/*
 * The `locationScopeServes` cases of the legacy catalog `location.spec.ts` (2;
 * deleted in Phase 4b, ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), COPIED, plus the `Service.servesLocation` convention the commit
 * re-check relies on (decide-booking.spec.ts: "empty means everywhere").
 *
 * Pass C (S-25, E-17): the chair's home shop — the staff dashboard's
 * `locationIds[0]` (staff-dashboard.spec.ts :6130, :6149 — a new visit and
 * a block in the chair's first shop) — and the visit sheet's «Салон»
 * threshold (`uiShops().length > 1`; staff-visit-editor.spec.ts :2809,
 * :2608, :2649 — the row hidden with one shop, shown with two).
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

describe('LocationScopeSystem.homeOf — the chair’s own shop', () => {
  it('is the first shop the scope lists', () => {
    expect(LocationScopeSystem.homeOf({ locationIds: [MLADOST, CENTER] })).toBe(
      MLADOST,
    );
    expect(LocationScopeSystem.homeOf({ locationIds: [CENTER] })).toBe(CENTER);
  });

  it('names no shop for an empty scope — the caller keeps its own fallback', () => {
    expect(LocationScopeSystem.homeOf({ locationIds: [] })).toBeNull();
  });

  it('reads a barber entity straight from the catalogue', () => {
    expect(
      LocationScopeSystem.homeOf(barberFixture({ locationIds: [CENTER] })),
    ).toBe(CENTER);
  });
});

describe('LocationScopeSystem.isMultiShop — shops to tell apart', () => {
  it('is true only for more than one shop', () => {
    expect(LocationScopeSystem.isMultiShop(0)).toBe(false);
    expect(LocationScopeSystem.isMultiShop(1)).toBe(false);
    expect(LocationScopeSystem.isMultiShop(2)).toBe(true);
    expect(LocationScopeSystem.isMultiShop(5)).toBe(true);
  });

  it('agrees with "more than one" for any count (property)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 50 }), (count) => {
        expect(LocationScopeSystem.isMultiShop(count)).toBe(count > 1);
      }),
    );
  });
});

describe('LocationScopeSystem — pass C purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const barber = deepFreeze({ locationIds: [MLADOST, CENTER] });
    const once = LocationScopeSystem.homeOf(barber);
    expect(LocationScopeSystem.homeOf(barber)).toBe(once);
    expect(barber).toEqual({ locationIds: [MLADOST, CENTER] });
    expect(LocationScopeSystem.isMultiShop(2)).toBe(
      LocationScopeSystem.isMultiShop(2),
    );
  });
});
