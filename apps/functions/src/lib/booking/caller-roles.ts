import { worksTheBook } from '@creativo/domain/accounts';

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
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const roles = token['roles'];
  return Array.isArray(roles) ? roles.map((role) => String(role)) : [];
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
