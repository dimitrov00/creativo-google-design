import { describe, expect, it } from 'vitest';
import { Tag } from '@core/primitives';
import { EnrollmentStatus } from './enrollment-status.data';

// The status list is `Tag.values(EnrollmentStatus)`; which are shown is
// `ProgramsSystem.isEnrollmentOpenOrUpcoming` (its cases live in
// `programs.system.spec.ts`). Pass D retired the `ENROLLMENT_STATUSES` /
// `isEnrollmentOpenOrUpcoming` delegates.
describe('EnrollmentStatus', () => {
  it('declares the statuses SCREAMING, in order', () => {
    expect(Tag.values(EnrollmentStatus)).toEqual([
      'OPEN',
      'UPCOMING',
      'CLOSED',
    ]);
  });
});
