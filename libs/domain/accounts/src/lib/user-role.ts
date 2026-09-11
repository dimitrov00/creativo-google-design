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
export const STAFF_ROLES: readonly UserRole[] = [
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

/**
 * The roles that WORK THE BOOK — the TypeScript twin of `worksTheBook()` in
 * `firestore.rules`.
 *
 * Deliberately NARROWER than `STAFF_ROLES`: `content_manager` is a
 * copy-and-media role, and the rules already refuse it every read on
 * `appointments` on the grounds that it has no business seeing every client's
 * name, phone and note. Until this existed the server disagreed with the
 * rules — every appointment callable gated on `STAFF_ROLES`, so a marketing
 * role could not READ an appointment but could confirm, cancel, no-show and
 * stamp arrival on one. A permission the reader is denied and the writer is
 * granted is not a narrow gap; it is the wrong way round.
 *
 * Keep this list and `worksTheBook()` in `firestore.rules` equal. They are
 * two dialects of one rule, and the rules file cannot import this one.
 */
export const BOOK_ROLES: readonly UserRole[] = [
  'barber',
  'receptionist',
  'admin',
  'sysadmin',
];

/**
 * Whether a role set may read and write the shop's book.
 *
 * Takes `readonly string[]` rather than `UserRole[]` because its callers hold
 * unvalidated claims off an ID token, and narrowing them first would mean
 * every call site rehearsing the same vocabulary check to no benefit — an
 * unrecognised string is simply not in `BOOK_ROLES` and grants nothing.
 */
export function worksTheBook(roles: readonly string[]): boolean {
  return roles.some((role) => (BOOK_ROLES as readonly string[]).includes(role));
}

/**
 * The roles that may SPEND THE SHOP'S MONEY on a booking — reprice a seat,
 * author an ad-hoc discount. The front desk and the owners; never a barber.
 *
 * A barber may stretch his own time; he may not discount the shop's money
 * (visit editor design record, §3.8). He MAY honour a promise the shop has
 * already made — a coupon the client holds, a code the shop published —
 * because refusing that at the chair is the shop breaking its own word, and
 * that act is gated on `worksTheBook`, not on this. Same three-role list
 * `firestore.rules` uses for listing the clientele.
 */
export const MONEY_ROLES: readonly UserRole[] = [
  'receptionist',
  'admin',
  'sysadmin',
];

/** Whether a role set may reprice a seat or invent a discount. Claims-tolerant like `worksTheBook`. */
export function handlesMoney(roles: readonly string[]): boolean {
  return roles.some((role) =>
    (MONEY_ROLES as readonly string[]).includes(role),
  );
}
