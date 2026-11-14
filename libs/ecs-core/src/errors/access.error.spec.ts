import { describe, expect, it } from 'vitest';
import { StaffCapability } from '@core/primitives';
import { AccessError, AccessErrorCode } from './access.error';

describe('AccessError', () => {
  it('uses three SCREAMING codes, each with the ACCESS_ prefix (staff permissions P6)', () => {
    expect(Object.values(AccessErrorCode)).toEqual([
      'ACCESS_NOT_STAFF',
      'ACCESS_DENIED',
      'ACCESS_OWN_ONLY',
    ]);
    for (const code of Object.values(AccessErrorCode)) {
      expect(code).toMatch(/^ACCESS_[A-Z_]+$/);
    }
  });

  it('answers a non-staff caller the code alone — one shared struct, it names nothing', () => {
    expect(AccessError.notStaff()).toEqual({ errorCode: 'ACCESS_NOT_STAFF' });
    expect(AccessError.notStaff()).toBe(AccessError.notStaff());
  });

  it('names the capability a caller lacks, or holds for their own record only — a tag, never a person', () => {
    expect(AccessError.denied(StaffCapability.Hours)).toEqual({
      errorCode: 'ACCESS_DENIED',
      staffCapability: 'HOURS',
    });
    expect(AccessError.ownOnly(StaffCapability.TimeOff)).toEqual({
      errorCode: 'ACCESS_OWN_ONLY',
      staffCapability: 'TIME_OFF',
    });
    for (const staffCapability of Object.values(StaffCapability)) {
      expect(Object.keys(AccessError.denied(staffCapability))).toEqual([
        'errorCode',
        'staffCapability',
      ]);
      expect(Object.keys(AccessError.ownOnly(staffCapability))).toEqual([
        'errorCode',
        'staffCapability',
      ]);
    }
  });
});
