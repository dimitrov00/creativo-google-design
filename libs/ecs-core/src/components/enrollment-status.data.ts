/**
 * A course's enrollment, set by the admin — the course's field
 * `enrollmentStatus`, the single source of truth for the Open/Upcoming
 * split on the public page (a course's timing "runs hot/cold"), not a date
 * derived from a start field. Stored SCREAMING since flip 4; the pages
 * still print today's lowercase word through their words tables. Every
 * status in key order is `Tag.values(EnrollmentStatus)`; which are shown
 * on the public page is `ProgramsSystem.isEnrollmentOpenOrUpcoming`.
 */
export const EnrollmentStatus = {
  Open: 'OPEN',
  Upcoming: 'UPCOMING',
  Closed: 'CLOSED',
} as const;
export type EnrollmentStatus =
  (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];
