import { Brand } from '@creativo/domain/kernel';

/**
 * Authorization-role brand carried by `AuthClaims`/`Principal`.
 *
 * This is a deliberately unvalidated placeholder — the real, closed role
 * enum (which roles exist, `isStaff`/`isAdmin` grouping semantics) is a
 * `governance` bounded-context concern that hasn't landed yet as of this
 * pass (see final report). Using the kernel's zero-cost `Brand` here
 * (rather than a bare `string`) keeps `AuthClaims`/`Principal` compliant
 * with the primitive-obsession ban today; swap this for governance's real
 * `Role` type once that context exists — everything here reads a role only
 * as an opaque, comparable token, never re-implements role semantics.
 */
export type Role = Brand<string, 'Role'>;

/** Rebuild from a value already known to be a valid role token (e.g. a token custom claim). */
export function roleFromPrimitive(trusted: string): Role {
  return trusted as Role;
}
