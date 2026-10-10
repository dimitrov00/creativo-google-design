import { describe, expect, it } from 'vitest';
import {
  ENROLLMENT_STATUSES,
  EnrollmentStatus,
  isEnrollmentOpenOrUpcoming,
  isEnrollmentStatus,
} from './enrollment-status.data';

describe('EnrollmentStatus', () => {
  it('keeps the stored strings', () => {
    expect(ENROLLMENT_STATUSES).toEqual(['open', 'upcoming', 'closed']);
  });

  it('guards untrusted text', () => {
    expect(isEnrollmentStatus('upcoming')).toBe(true);
    expect(isEnrollmentStatus('Open')).toBe(false);
    expect(isEnrollmentStatus(null)).toBe(false);
  });

  it('shows an open or an upcoming course, never a closed one', () => {
    expect(isEnrollmentOpenOrUpcoming(EnrollmentStatus.Open)).toBe(true);
    expect(isEnrollmentOpenOrUpcoming(EnrollmentStatus.Upcoming)).toBe(true);
    expect(isEnrollmentOpenOrUpcoming(EnrollmentStatus.Closed)).toBe(false);
  });
});
