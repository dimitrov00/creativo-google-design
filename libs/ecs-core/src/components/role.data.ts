import { AccountsError, Result } from '@core/primitives';

/**
 * The roles a user account may hold — the ONLY source of these strings
 * (`users.roles`, the ID token's `roles` claim, `firestore.rules`'
 * `hasAnyRole([...])` lists) — claim and rules values, exempt from the
 * SCREAMING sweep (flatten-spec §0.4, OQ-3). No brand: the stored strings
 * are unchanged, and
 * guards compare `Role.Admin`, never a bare `'admin'` (blueprint §2.4).
 *
 * A user holds a SET of roles — a shop owner is commonly `barber` AND
 * `admin` — so the predicates below take role lists. v2's `customer` is
 * `client` here, the workspace's own word for the customer-facing area.
 */
export const Role = {
  Client: 'client',
  Barber: 'barber',
  Receptionist: 'receptionist',
  ContentManager: 'content_manager',
  Admin: 'admin',
  Sysadmin: 'sysadmin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Every role, dictionary order — derived, never a second source. */
export const USER_ROLES: readonly Role[] = Object.values(Role);

/**
 * Roles that grant the STAFF-tier area: everyone who is not a plain client
 * (deliberately broader than v2's `isStaff`, which left `admin`/`sysadmin` to
 * a separate tier). `firestore.rules`' `isStaff()` is its twin
 * (`role.rules-parity.spec.ts` holds them equal).
 */
export const STAFF_ROLES = [
  Role.Barber,
  Role.Receptionist,
  Role.ContentManager,
  Role.Admin,
  Role.Sysadmin,
] as const;

/**
 * The roles that WORK THE BOOK — the twin of `worksTheBook()` in
 * `firestore.rules`. Narrower than `STAFF_ROLES`: `content_manager` is a
 * copy-and-media role the rules refuse every read on `appointments`, so the
 * callables must refuse it every write too — a permission the reader is
 * denied and the writer granted is the wrong way round.
 */
export const BOOK_ROLES = [
  Role.Barber,
  Role.Receptionist,
  Role.Admin,
  Role.Sysadmin,
] as const;

/**
 * The roles that may SPEND THE SHOP'S MONEY on a booking — reprice a seat,
 * author an ad-hoc discount. The front desk and the owners, never a barber
 * (who may still honour a coupon the client holds: that act is gated on
 * `mayBook`). The same three roles `firestore.rules` lets list the clientele.
 */
export const MONEY_ROLES = [
  Role.Receptionist,
  Role.Admin,
  Role.Sysadmin,
] as const;

/**
 * Roles that grant the ADMIN area and its writes — `firestore.rules`'
 * `isAdmin()` (an admin or the sysadmin). ONE home: the admin routes, the
 * shell's admin entry and the impersonation callables' caller gate read it
 * (Phase 4a §3.2).
 */
export const ADMIN_ROLES = [Role.Admin, Role.Sysadmin] as const;

/** Linear scan of a short constant list — no allocation, no `includes` cast. */
function listHas(list: readonly string[], value: unknown): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

/** Whether any member of `held` is in `granting` — claims-tolerant. */
function anyIn(granting: readonly string[], held: readonly string[]): boolean {
  for (let i = 0; i < held.length; i++) {
    if (listHas(granting, held[i])) return true;
  }
  return false;
}

/** The edge guard for an untrusted value — a stored array entry, a token claim. */
export function isRole(value: unknown): value is Role {
  return listHas(USER_ROLES, value);
}

/**
 * The edge guard with a refusal: a known role, or `ACCOUNTS_USER_ROLE_INVALID`
 * carrying the raw text (an admin's pick, a callable payload).
 */
export function parseRole(raw: string): Result<Role, AccountsError> {
  return isRole(raw)
    ? Result.ok(raw)
    : Result.err(AccountsError.userRoleInvalid(raw));
}

/**
 * The known roles of an untrusted list, in order, each once — an
 * unrecognised string is not a role, grants nothing and is dropped (a token
 * claim, a `users.roles` array read back).
 */
export function knownRoles(raw: readonly unknown[]): readonly Role[] {
  const out: Role[] = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (isRole(value) && !listHas(out, value)) out.push(value);
  }
  return out;
}

/** Whether a single role is a staff-tier role. */
export function isStaffRole(role: Role): boolean {
  return listHas(STAFF_ROLES, role);
}

/** Whether a role set grants the staff area (any member qualifies). */
export function isStaff(roles: readonly Role[]): boolean {
  return anyIn(STAFF_ROLES, roles);
}

/**
 * Whether a role set may read and write the shop's book (`worksTheBook`).
 * Takes `readonly string[]` because callers hold unvalidated claims off an ID
 * token: an unrecognised string is simply not in `BOOK_ROLES`.
 */
export function mayBook(roles: readonly string[]): boolean {
  return anyIn(BOOK_ROLES, roles);
}

/** Whether a role set may reprice a seat or invent a discount (`handlesMoney`). Claims-tolerant like `mayBook`. */
export function seesMoney(roles: readonly string[]): boolean {
  return anyIn(MONEY_ROLES, roles);
}

/**
 * Whether a role set holds the admin pair (`ADMIN_ROLES`, the rules'
 * `isAdmin()`) — the impersonation callables' and the owner-only gates.
 * Claims-tolerant like `mayBook`: an entry counts only when it IS one of
 * the two roles.
 */
export function isAdmin(roles: readonly string[]): boolean {
  return anyIn(ADMIN_ROLES, roles);
}
