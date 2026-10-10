import { describe, expect, it } from 'vitest';
import { PlacementPolicy, StaffTermsOverride } from './placement-policy.data';
import { ServiceTerms } from './service-terms.data';

describe('PlacementPolicy', () => {
  it('holds a client to every rule', () => {
    expect(PlacementPolicy.clientDefault()).toEqual({
      allowOutsideWindow: false,
      allowOverlap: false,
      allowConflictingServices: false,
      skipMinNotice: false,
    });
  });

  it('lets the shop place a walk-in outside the roster and without notice — and nothing more (§9 D18)', () => {
    expect(PlacementPolicy.staffWalkIn()).toEqual({
      allowOutsideWindow: true,
      skipMinNotice: true,
      allowOverlap: false,
      allowConflictingServices: false,
    });
  });

  it('allows an overlap only once it is acknowledged', () => {
    const acknowledged = PlacementPolicy.withOverlap(
      PlacementPolicy.staffWalkIn(),
      true,
    );
    expect(acknowledged.allowOverlap).toBe(true);
    expect(PlacementPolicy.staffWalkIn().allowOverlap).toBe(false);
    expect(
      PlacementPolicy.equals(
        PlacementPolicy.withOverlap(acknowledged, false),
        PlacementPolicy.staffWalkIn(),
      ),
    ).toBe(true);
    expect(
      PlacementPolicy.equals(
        PlacementPolicy.clientDefault(),
        PlacementPolicy.staffWalkIn(),
      ),
    ).toBe(false);
  });
});

describe('StaffTermsOverride', () => {
  const terms = ServiceTerms.unpadded(2000, 'EUR', 45);

  it('finds the override a seat was re-priced by, or none', () => {
    const overrides = [StaffTermsOverride.of('line-1', terms)];
    expect(StaffTermsOverride.find(overrides, 'line-1')).toEqual({
      seatKey: 'line-1',
      priceMinorUnits: 2000,
      currencyCode: 'EUR',
      durationMinutes: 45,
      setupMinutes: 0,
      cleanupMinutes: 0,
    });
    expect(StaffTermsOverride.find(overrides, 'line-2')).toBeNull();
  });

  it('carries a seat with every figure left to the catalogue', () => {
    expect(StaffTermsOverride.carried('line-3')).toEqual({
      seatKey: 'line-3',
      priceMinorUnits: null,
      currencyCode: null,
      durationMinutes: null,
      setupMinutes: null,
      cleanupMinutes: null,
    });
  });
});
