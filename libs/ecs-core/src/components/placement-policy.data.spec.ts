import { describe, expect, it } from 'vitest';
import { termsFixture } from '@core/testing';
import { SeatKeyText } from '@core/primitives';
import { PlacementPolicy, StaffTermsOverride } from './placement-policy.data';

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

  it('lets the shop place or move its own book outside the roster, without notice and with any service mix — never an unacknowledged overlap', () => {
    expect(PlacementPolicy.staffPlacement()).toEqual({
      allowOutsideWindow: true,
      skipMinNotice: true,
      allowOverlap: false,
      allowConflictingServices: true,
    });
    // The staff edit acknowledges the overlap on top of the same preset.
    expect(
      PlacementPolicy.withOverlap(PlacementPolicy.staffPlacement(), true),
    ).toEqual({
      allowOutsideWindow: true,
      skipMinNotice: true,
      allowOverlap: true,
      allowConflictingServices: true,
    });
    // Not the walk-in preset (D18 keeps conflicting services refused there).
    expect(
      PlacementPolicy.equals(
        PlacementPolicy.staffPlacement(),
        PlacementPolicy.staffWalkIn(),
      ),
    ).toBe(false);
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
  const terms = termsFixture(2000, 45);

  it('finds the override a seat was re-priced by, or none', () => {
    const overrides = [StaffTermsOverride.of(SeatKeyText.of('line-1'), terms)];
    expect(StaffTermsOverride.find(overrides, 'line-1')).toEqual({
      seatKey: 'line-1',
      priceCents: 2000,
      currency: 'EUR',
      durationMinutes: 45,
      setupMinutes: 0,
      cleanupMinutes: 0,
    });
    expect(StaffTermsOverride.find(overrides, 'line-2')).toBeNull();
  });

  it('carries a seat with every figure left to the catalogue', () => {
    expect(StaffTermsOverride.carried(SeatKeyText.of('line-3'))).toEqual({
      seatKey: 'line-3',
      priceCents: null,
      currency: null,
      durationMinutes: null,
      setupMinutes: null,
      cleanupMinutes: null,
    });
  });
});
