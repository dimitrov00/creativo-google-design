import { StoredFields, UserId } from '@core/primitives';
import { Actor, type Role, Roles } from '@core/components';

/**
 * THE CALLER, off the VERIFIED ID token — the ONE home of every reading a
 * callable makes of who is asking (Phase 4a §1.3: `booking.wire.ts`' private
 * `rolesOf`/`actorOf` and this file's helpers folded together, reuse never
 * copy). Every gate judges the token's `roles` claim and nothing else.
 *
 * `request.auth.token.roles` is a custom claim minted by `verifyOtp` from the
 * user document, and rules keep that document's `roles` field Admin-SDK-only
 * — so a client cannot grant itself one. Read defensively all the same: a
 * token with no claim, or a claim that is not an array, yields no roles
 * rather than throwing on a shape nobody promised.
 *
 * Two readings of the claim's ENTRIES live side by side, each pinned
 * (§9 R6), because their callers always read them so:
 * - {@link callerRoles} String-coerces every entry (the book, ops and
 *   loyalty gates, and {@link callerActor}'s attribution);
 * - {@link callerActorAsClaimed} hands the entries to `Actor.forCaller` as
 *   they are (the booking callables' attribution).
 * They part only on a claim nobody mints (`[['admin']]`, a number).
 */

/** A callable request, as far as the caller is read off it. */
export type VerifiedRequest = {
  readonly auth?: {
    readonly uid?: string;
    readonly token?: object;
  } | null;
};

/** The verified caller's uid, or `null` — an empty uid is nobody. */
export function callerUserId(request: VerifiedRequest): UserId | null {
  const uid = UserId.parse(request.auth?.uid ?? '');
  return uid.ok ? uid.value : null;
}

/** The `roles` claim as the token holds it: its entries untouched, none when it is no array. */
function claimedRoles(request: VerifiedRequest): readonly unknown[] {
  const roles = StoredFields.field(request.auth?.token, 'roles');
  return Array.isArray(roles) ? roles : [];
}

/** The claim's entries as strings, in the order given. */
export function callerRoles(request: VerifiedRequest): readonly string[] {
  return claimedRoles(request).map((role) => String(role));
}

/**
 * The claim's KNOWN roles, each once — what a pipeline that names `Role[]`
 * is handed (the impersonation callables' gate). Read off the entries AS
 * THEY ARE, as {@link callerIsAdmin} and the rules' `hasAny` read them: a
 * list inside the list is no role.
 */
export function callerKnownRoles(request: VerifiedRequest): readonly Role[] {
  return Roles.known(claimedRoles(request));
}

/**
 * May this caller work the book? The ONE gate every appointment callable
 * uses, and deliberately not `Roles.STAFF`: a `content_manager` that
 * `firestore.rules` refuses every appointment READ must not be handed the
 * writes (`Roles.mayBook`, `Roles.BOOK`).
 */
export function callerWorksTheBook(request: VerifiedRequest): boolean {
  return Roles.mayBook(callerRoles(request));
}

/**
 * May this caller change how the shop runs: publish the rhythm's rule,
 * open or end an impersonation, and whatever else only the owner's pair
 * decides? The same two roles `firestore.rules` admits with `isAdmin()`
 * (`Roles.isAdmin`, `Roles.ADMIN`; `caller-roles.spec.ts` reads the rules and
 * holds them equal). Never a second read of `users/{uid}`: a document read can
 * disagree with the token the rules just judged by.
 *
 * An entry counts only when it IS the role, a string spelled as the rules
 * spell it: `String(['admin'])` is `'admin'`, so a list inside the list
 * would pass a coerced reading and fail `hasAny` in the rules — this gate
 * reads the entries as they are.
 */
export function callerIsAdmin(request: VerifiedRequest): boolean {
  return Roles.isAdmin(callerKnownRoles(request));
}

/**
 * Who the audit log says did this — the verified uid, attributed by its
 * String-coerced roles (`Actor.forCaller`): an admin as `ADMIN`, other
 * staff as `STAFF` with a snapshot of their roles, a client as `USER`.
 * Access is not attribution: the vendor's `sysadmin` is `STAFF`.
 *
 * `null` when there is no verified caller: nobody to attribute, and
 * inventing one would be the very misattribution this exists to end.
 */
export function callerActor(request: VerifiedRequest): Actor | null {
  const uid = callerUserId(request);
  return uid === null ? null : Actor.forCaller(uid, callerRoles(request));
}

/** {@link callerActor} over the claim's entries AS THEY ARE — the booking callables' reading. */
export function callerActorAsClaimed(request: VerifiedRequest): Actor | null {
  const uid = callerUserId(request);
  return uid === null ? null : Actor.forCaller(uid, claimedRoles(request));
}
