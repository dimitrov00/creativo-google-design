import { EnrollmentStatus, PositionStatus } from '@core/components';

/*
 * The programs' status words — the lowercase text the admin lists and the
 * public /careers and /courses badges have always printed (flip 4, F4-7).
 * The stored tags are SCREAMING (`OPEN`, `UPCOMING`, `CLOSED`); the words
 * are not, and stay untranslated — localising them is a follow-up (flip-4
 * plan §10.2). One table, read by every surface that prints a status.
 */

/** A role's status as it is printed. */
export const positionStatusWords = {
  [PositionStatus.Open]: 'open',
  [PositionStatus.Closed]: 'closed',
} as const satisfies Record<PositionStatus, string>;

/** A course's enrolment status as it is printed. */
export const enrollmentStatusWords = {
  [EnrollmentStatus.Open]: 'open',
  [EnrollmentStatus.Upcoming]: 'upcoming',
  [EnrollmentStatus.Closed]: 'closed',
} as const satisfies Record<EnrollmentStatus, string>;
