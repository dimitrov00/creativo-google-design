import { describe, expect, it } from 'vitest';
import { PlacementPolicy } from './placement-policy.data';

describe('PlacementPolicy', () => {
  it('holds a client to every rule', () => {
    expect(PlacementPolicy.clientDefault()).toEqual({
      allowOutsideWindow: false,
      allowOverlap: false,
      allowConflictingServices: false,
      skipMinNotice: false,
    });
  });

  it('lets the shop place or move its own book — a walk-in included — outside the roster, without notice and with any service mix, never an unacknowledged overlap (OR-11, DEP-F9)', () => {
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
  });

  it('allows an overlap only once it is acknowledged, and withdraws it again', () => {
    const acknowledged = PlacementPolicy.withOverlap(
      PlacementPolicy.staffPlacement(),
      true,
    );
    expect(acknowledged.allowOverlap).toBe(true);
    expect(PlacementPolicy.staffPlacement().allowOverlap).toBe(false);
    expect(PlacementPolicy.withOverlap(acknowledged, false)).toEqual(
      PlacementPolicy.staffPlacement(),
    );
    expect(PlacementPolicy.clientDefault()).not.toEqual(
      PlacementPolicy.staffPlacement(),
    );
  });

  it('is pure: the presets are the same value every call, and withOverlap leaves its input untouched', () => {
    expect(PlacementPolicy.staffPlacement()).toBe(
      PlacementPolicy.staffPlacement(),
    );
    const base = PlacementPolicy.staffPlacement();
    PlacementPolicy.withOverlap(base, true);
    expect(base.allowOverlap).toBe(false);
  });
});
