/**
 * A course's enrollment, set by the admin — the single source of truth for
 * the Open/Upcoming split on the public page (a course's timing "runs
 * hot/cold"), not a date derived from a start field. The stored strings of
 * `CourseEnrollmentStatus` (`course.ts:13`), unchanged.
 */
export const EnrollmentStatus = {
  Open: 'open',
  Upcoming: 'upcoming',
  Closed: 'closed',
} as const;
export type EnrollmentStatus =
  (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];

/** Every enrollment status, dictionary order — derived, never a second source. */
export const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] =
  Object.values(EnrollmentStatus);

export function isEnrollmentStatus(raw: unknown): raw is EnrollmentStatus {
  for (let i = 0; i < ENROLLMENT_STATUSES.length; i++) {
    if (ENROLLMENT_STATUSES[i] === raw) return true;
  }
  return false;
}

/** Shown on the public page: open now, or opening (`Course.isOpenOrUpcoming`). */
export function isEnrollmentOpenOrUpcoming(status: EnrollmentStatus): boolean {
  return status !== EnrollmentStatus.Closed;
}
