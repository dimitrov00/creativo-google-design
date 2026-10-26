import type { Observable } from 'rxjs';
import type { Result, UserId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Role } from '@core/components';
import type { Customer, User } from '@core/entities';

/**
 * The accounts context's ports (blueprint §4.1, §4.2) over `users/{uid}` —
 * the flat `User` straight from `snap.data()` (§9 D19), no mapper and
 * no search-result view model. The reads answer the STORED body, a
 * `PROVISIONED` stub included: whether a stub counts as "no profile" is the
 * consumer's call (`Registration.isRegistered`), never the adapter's.
 * Beside the account search sits the search over the client records
 * (`customers`, OR-26), answered as stored too.
 *
 * Profile WRITES are the server's alone (Phase 4a 4A-3 (2)): the
 * `updateProfile` callable runs `ProfileEditSystem.decide` inside its own
 * transaction, and `users/{uid}` refuses every client update. No
 * contact-change ports: §9 D12(b), contact change is not shipped.
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
 * The staff client search over the shop's client RECORDS (OR-26) —
 * `customers` where `searchPrefixes array-contains prefix`, `orderBy
 * searchName`, at most `limit` (its composite index declared with the
 * adapter). The same normalised `prefix` as {@link SearchUsers}: the client
 * book merges both answers through `ClientQuerySystem`'s ranking, so a
 * walk-in the desk entered — a record with no account — is found again.
 */
export type SearchCustomers = (
  prefix: string,
  limit: number,
) => Promise<Result<readonly Customer[], RepositoryError>>;

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
 * The STORED roles of `users/{uid}` — the server's second check behind a
 * token claim (`run-backfill.ts:715-728` re-reads them for `sysadmin`), and
 * the `loadCallerRoles` read of `transitionAppointment`, `updateProfile`
 * and the impersonation pipelines (§4.1). `[]` for an unknown uid.
 */
export type LoadCallerRoles = (
  userId: UserId,
) => Promise<Result<readonly Role[], RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** An account's own profile — live and once (web, `PROFILE_PORTS`). */
export type ProfilePorts = {
  readonly observeProfile: ObserveProfile;
  readonly loadProfile: LoadProfile;
};

/** The staff client search (web, `USER_SEARCH_PORTS`). */
export type UserSearchPorts = {
  readonly searchUsers: SearchUsers;
};

/** The staff client search over the client records (web, its own token). */
export type CustomerSearchPorts = {
  readonly searchCustomers: SearchCustomers;
};

/** The stored roles behind a token claim (server). */
export type CallerRolesPorts = {
  readonly loadCallerRoles: LoadCallerRoles;
};

/** The accounts context's whole port suite — an intersection of its bundles. */
export type AccountsPorts = ProfilePorts &
  UserSearchPorts &
  CustomerSearchPorts &
  CallerRolesPorts;
