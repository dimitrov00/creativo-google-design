import { UserId, worksTheBook } from '@creativo/domain/accounts';
import { type Actor, actorForCaller } from '@creativo/domain/governance';

/**
 * The caller's roles, off the VERIFIED ID token.
 *
 * `request.auth.token.roles` is a custom claim minted by `verifyOtp` from the
 * user document, and rules keep that document's `roles` field Admin-SDK-only
 * — so a client cannot grant itself one. Read defensively all the same: a
 * token with no claim, or a claim that is not an array, yields no roles
 * rather than throwing on a shape nobody promised.
 */
export function callerRoles(request: {
  auth?: { token?: object };
}): readonly string[] {
  return claimedRoles(request).map((role) => String(role));
}

/** The `roles` claim as the token holds it: its entries untouched, none when it is no array. */
function claimedRoles(request: {
  auth?: { token?: object };
}): readonly unknown[] {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const roles = token['roles'];
  return Array.isArray(roles) ? roles : [];
}

/**
 * May this caller work the book?
 *
 * The ONE gate every appointment callable uses, and deliberately not
 * `STAFF_ROLES`: see `worksTheBook` in `@creativo/domain/accounts` for why a
 * `content_manager` that `firestore.rules` refuses every appointment READ
 * must not be handed the writes.
 *
 * Lives here rather than being copied into each callable because it was
 * copied into each callable — `transitionAppointment` and `markArrived` both
 * carried their own `isStaffCaller`, and both were wrong in the same way.
 */
export function callerWorksTheBook(request: {
  auth?: { token?: object };
}): boolean {
  return worksTheBook(callerRoles(request));
}

/**
 * The pair that MANAGES THE SHOP: the TypeScript twin of `isAdmin()` in
 * `firestore.rules`. Two dialects of one rule, and the rules file cannot
 * import this one: keep the two lists equal (`caller-roles.spec.ts` reads
 * the rules and holds them so).
 */
export const ADMIN_ROLES: readonly string[] = ['admin', 'sysadmin'];

/**
 * May this caller change how the shop runs: publish the rhythm's rule, and
 * whatever else only the owner's pair decides?
 *
 * The same source as every other gate here, the VERIFIED token's claim, and
 * the same two roles `firestore.rules` admits with `isAdmin()`. Never a
 * second read of `users/{uid}`: a document read can disagree with the token
 * the rules just judged by, and then one caller is an admin to the callable
 * and nobody to the rules. A missing claim, or one that is not an array,
 * manages nothing.
 *
 * An entry counts only when it IS the role, a string spelled as the rules
 * spell it. `callerRoles` makes a string of whatever the claim holds, and
 * `String(['admin'])` is `'admin'`: a list inside the list would pass here
 * and fail `hasAny` in the rules, so this gate reads the entries as they
 * are.
 *
 * Access, not attribution: `callerActor` still records the vendor's
 * `sysadmin` as `staff`, so the log tells the owner's act from the vendor's.
 */
export function callerIsAdmin(request: { auth?: { token?: object } }): boolean {
  return claimedRoles(request).some(
    (role) => typeof role === 'string' && ADMIN_ROLES.includes(role),
  );
}

/**
 * Who the audit log says did this — the verified uid, attributed by its roles
 * (`actorForCaller`): an admin as `admin`, other staff as `staff` with a
 * snapshot of their roles, a client as `user`.
 *
 * `null` when there is no verified caller: nobody to attribute, and inventing
 * one (the owner, a `system` source) would be the very misattribution this
 * exists to end.
 */
export function callerActor(request: {
  auth?: { uid?: string; token?: object };
}): Actor | null {
  const uid = UserId.create(request.auth?.uid ?? '');
  return uid.isSuccess()
    ? actorForCaller(uid.value, callerRoles(request))
    : null;
}
