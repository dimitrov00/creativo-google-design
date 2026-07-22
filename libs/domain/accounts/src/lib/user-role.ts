/**
 * High-level role on a user account. A genuinely closed enum — no VO
 * wrapper needed for the value itself (mirrors this repo's existing
 * `models/role.ts` convention), but a user's `roles` field is validated
 * against this vocabulary at the `User` factory boundary (see `user.ts`).
 *
 * Vocabulary ported from v2's `UserRole.ts`, with one deliberate rename:
 * v2's `customer` is renamed to `client` to match this workspace's own
 * `scope:client`/`apps/client` vocabulary (see migration blueprint §0.2,
 * §1.1) — everywhere else in this codebase the customer-facing area is
 * called "client", so the role vocabulary now agrees with it.
 *
 * v2 models roles as a SET (`NonEmptyArray<UserRole>`) — a user may hold
 * several at once (e.g. a shop owner is commonly `barber` AND `admin`).
 * `isStaff` is provided both as a single-role predicate and a
 * set-membership check for that reason.
 */
export type UserRole =
  | 'client'
  | 'barber'
  | 'receptionist'
  | 'content_manager'
  | 'admin'
  | 'sysadmin';

export const USER_ROLES: readonly UserRole[] = [
  'client',
  'barber',
  'receptionist',
  'content_manager',
  'admin',
  'sysadmin',
];

/**
 * Roles that grant access to a STAFF-tier area. NOTE — deviation from v2:
 * v2's own `UserRole.isStaff` covers only `barber | receptionist |
 * content_manager`, treating `admin | sysadmin` as a separate `isAdmin`
 * tier. This accounts context's `isStaff` is intentionally broader per
 * this pass's spec (`barber | receptionist | content_manager | admin |
 * sysadmin` are staff; `client` is not) — everyone who isn't a plain
 * client is staff.
 */
const STAFF_ROLES: readonly UserRole[] = [
  'barber',
  'receptionist',
  'content_manager',
  'admin',
  'sysadmin',
];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

/** Whether a single role is a staff-tier role. */
export function isStaffRole(role: UserRole): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** Whether a role set grants access to the staff area (any member qualifies). */
export function isStaff(roles: readonly UserRole[]): boolean {
  return roles.some(isStaffRole);
}
