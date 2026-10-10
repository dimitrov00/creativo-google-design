/**
 * A careers-page role's stored `status` — the `as const` dictionary replacing
 * programs' bare `PositionStatus` union (`position.ts:11`), the ONLY source of
 * these strings. Values unchanged: index #12 filters `status == 'open'`.
 *
 * Admin-managed — a plain field an admin flips (as `LocationState`), not a
 * domain-enforced transition graph, so there are no companion members; a
 * role is open when `position.status === PositionState.Open`. Courses keep
 * their own `EnrollmentStatus` (`enrollment-status.data.ts`).
 */
export const PositionState = {
  Open: 'open',
  Closed: 'closed',
} as const;
export type PositionState = (typeof PositionState)[keyof typeof PositionState];
