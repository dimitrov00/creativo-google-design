import { describe, expect, it } from 'vitest';
import { PlacementKind } from './placement-kind.data';

describe('PlacementKind', () => {
  it('reads the two stored tags unchanged', () => {
    expect(PlacementKind.Self).toBe('self');
    expect(PlacementKind.Staff).toBe('staff');
  });

  it('parses a stored value, and reads anything else as unknown', () => {
    expect(PlacementKind.parse('self')).toBe(PlacementKind.Self);
    expect(PlacementKind.parse('staff')).toBe(PlacementKind.Staff);
    for (const raw of [null, undefined, '', 'Staff', 'client', 1]) {
      expect(PlacementKind.parse(raw)).toBeNull();
    }
  });

  it('answers which side placed it, never guessing for null', () => {
    expect(PlacementKind.isSelf(PlacementKind.Self)).toBe(true);
    expect(PlacementKind.isStaff(PlacementKind.Staff)).toBe(true);
    expect(PlacementKind.isSelf(null)).toBe(false);
    expect(PlacementKind.isStaff(null)).toBe(false);
    expect(PlacementKind.isStaff(PlacementKind.Self)).toBe(false);
  });
});
