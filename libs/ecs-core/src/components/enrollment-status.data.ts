/**
 * A course's enrollment, set by the admin — the course's field
 * `enrollmentStatus`, the single source of truth for the Open/Upcoming
 * split on the public page (a course's timing "runs hot/cold"), not a date
 * derived from a start field. Stored SCREAMING since flip 4; the pages
 * still print today's lowercase word through their words tables.
 */
export const EnrollmentStatus = {
  Open: 'OPEN',
  Upcoming: 'UPCOMING',
  Closed: 'CLOSED',
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

/**
 * Shown on the public page: open now, or opening — `MarketingCourses`'
 * `LISTED_STATUSES`, the values of index #11's `in` filter.
 */
export function isEnrollmentOpenOrUpcoming(status: EnrollmentStatus): boolean {
  return status !== EnrollmentStatus.Closed;
}
