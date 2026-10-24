import { describe, expect, it } from 'vitest';
import {
  ENROLLMENT_STATUSES,
  EnrollmentStatus,
  isEnrollmentOpenOrUpcoming,
} from './enrollment-status.data';

describe('EnrollmentStatus', () => {
  it('declares the statuses SCREAMING, in order', () => {
    expect(ENROLLMENT_STATUSES).toEqual(['OPEN', 'UPCOMING', 'CLOSED']);
  });

  it('shows an open or an upcoming course, never a closed one', () => {
    expect(isEnrollmentOpenOrUpcoming(EnrollmentStatus.Open)).toBe(true);
    expect(isEnrollmentOpenOrUpcoming(EnrollmentStatus.Upcoming)).toBe(true);
    expect(isEnrollmentOpenOrUpcoming(EnrollmentStatus.Closed)).toBe(false);
  });
});
