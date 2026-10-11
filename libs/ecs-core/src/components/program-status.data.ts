/**
 * A careers-page role's status — the position's field `positionStatus`
 * (was `status`, N8). Index #12 filters it (re-declared by the programs
 * flip; the stored bytes stay today's lowercase until then).
 *
 * Admin-managed — a plain field an admin flips (as `LocationStatus`), not a
 * domain-enforced transition graph, so there are no companion members; a
 * role is open when `position.positionStatus === PositionStatus.Open`.
 * Courses keep their own `EnrollmentStatus` (`enrollment-status.data.ts`).
 */
export const PositionStatus = {
  Open: 'OPEN',
  Closed: 'CLOSED',
} as const;
export type PositionStatus =
  (typeof PositionStatus)[keyof typeof PositionStatus];
