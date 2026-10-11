import { describe, expect, it } from 'vitest';
import { Placement } from './placement-kind.data';

describe('Placement', () => {
  it('pins the two tags', () => {
    expect(Placement.Self).toBe('SELF');
    expect(Placement.Staff).toBe('STAFF');
  });

  it('parses a tag, and reads anything else as unknown', () => {
    expect(Placement.parse('SELF')).toBe(Placement.Self);
    expect(Placement.parse('STAFF')).toBe(Placement.Staff);
    for (const raw of [null, undefined, '', 'Staff', 'self', 'client', 1]) {
      expect(Placement.parse(raw)).toBeNull();
    }
  });

  it('answers which side placed it, never guessing for null', () => {
    expect(Placement.isSelf(Placement.Self)).toBe(true);
    expect(Placement.isStaff(Placement.Staff)).toBe(true);
    expect(Placement.isSelf(null)).toBe(false);
    expect(Placement.isStaff(null)).toBe(false);
    expect(Placement.isStaff(Placement.Self)).toBe(false);
  });
});
