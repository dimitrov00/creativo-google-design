import type { Observable } from 'rxjs';
import type { RepositoryError, Result, UserId } from '@core/primitives';
import type { Role } from '@core/components';
import type { OwnerProfileFields, User } from '@core/entities';

/**
 * The accounts context's ports (blueprint §4.1, §4.2) over `users/{uid}` —
 * the flat `User` straight from `snap.data()` (§9 D19), no mapper and
 * no search-result view model. The reads answer the STORED body, a
 * `PROVISIONED` stub included: whether a stub counts as "no profile" is the
 * consumer's call (`Registration.isRegistered`), never the adapter's.
 *
 * Profile WRITES: the server's `updateProfile` callable runs
 * `ProfileEditSystem.decide` inside its own transaction; until Phase 4
 * switches the web's profile sheet to that callable, the owner's own write
 * is {@link WriteOwnProfile}, which runs the SAME decide inside the browser
 * transaction (F2-5, F2-6) — one rule, two writers. No contact-change
 * ports: §9 D12(b), contact change is not shipped.
 */

/**
 * The staff client search — `searchPrefixes array-contains prefix`,
 * `orderBy searchName`, at most `limit` (index #8). `prefix` is already
 * normalised by the caller (`SearchFieldsSystem.normalizeQuery`: a
 * lower-cased name token, or phone digits).
 */
export type SearchUsers = (
  prefix: string,
  limit: number,
) => Promise<Result<readonly User[], RepositoryError>>;

/**
 * `users/{uid}`, live — `null` while the document is absent (before the
 * account's first sign-in creates the stub); the stub itself as stored.
 */
export type ObserveProfile = (
  userId: UserId,
) => Observable<Result<User | null, RepositoryError>>;

/**
 * `users/{uid}`, one read — `null` only when absent; a `PROVISIONED` stub
 * answers as stored (the consumer maps `!Registration.isRegistered(user)`
 * to "no profile" at its call site).
 */
export type LoadProfile = (
  userId: UserId,
) => Promise<Result<User | null, RepositoryError>>;

/**
 * The owner's profile edit (F2-6): reads `users/{uid}` and writes the five
 * keys `decide` answers with ONE root-key `update`, in ONE transaction. A
 * `null` answer (nothing changed — value-idempotent) writes nothing; a
 * refusal writes nothing and is answered as is. The adapter holds no rule:
 * `decide` is `ProfileEditSystem.decide` bound to the edits and the age
 * day, and `stored` is the transaction's read (`null` when absent).
 */
export type WriteOwnProfile = <E>(
  userId: UserId,
  decide: (stored: User | null) => Result<OwnerProfileFields | null, E>,
) => Promise<Result<void, E | RepositoryError>>;

/**
 * The STORED roles of `users/{uid}` — the server's second check behind a
 * token claim (`run-backfill.ts:715-728` re-reads them for `sysadmin`), and
 * the `loadCallerRoles` read of `transitionAppointment`, `updateProfile`
 * and the impersonation pipelines (§4.1). `[]` for an unknown uid.
 */
export type LoadCallerRoles = (
  userId: UserId,
) => Promise<Result<readonly Role[], RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** An account's own profile — live, once, and the owner's edit (web, `PROFILE_PORTS`). */
export type ProfilePorts = {
  readonly observeProfile: ObserveProfile;
  readonly loadProfile: LoadProfile;
  readonly writeOwnProfile: WriteOwnProfile;
};

/** The staff client search (web, `USER_SEARCH_PORTS`). */
export type UserSearchPorts = {
  readonly searchUsers: SearchUsers;
};

/** The stored roles behind a token claim (server). */
export type CallerRolesPorts = {
  readonly loadCallerRoles: LoadCallerRoles;
};

/** The accounts context's whole port suite — an intersection of its bundles. */
export type AccountsPorts = ProfilePorts & UserSearchPorts & CallerRolesPorts;
