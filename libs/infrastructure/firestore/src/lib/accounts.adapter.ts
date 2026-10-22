import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Collections, type User } from '@core/entities';
import type { ProfilePorts, UserSearchPorts } from '@core/ports';
import { observeDoc, readDoc, readQuery } from './observe';

/**
 * `users/{uid}`, the account's own profile (flip 2, plan §3.4) — the
 * successor of the legacy profile class adapter, WITHOUT its mapper and its
 * rule. The body IS the flat `User` minus `id` (Law 5), so a read is
 * `{ id, ...snap.data() }` and nothing else: `observeProfile` and
 * `loadProfile` answer the STORED document — a `PROVISIONED` stub included,
 * `null` only while there is no document. Whether a stub counts as "no
 * profile yet" is the consumer's call (`Registration.isRegistered`), never
 * this adapter's (F2-16, §3.5).
 *
 * Read-only on the web (4A-3 (2)): the document is created and edited
 * server-side only — `verifyOtp`'s stub, `completeRegistration`'s body, and
 * every owner edit through the `updateProfile` callable (`saveOwnProfile`),
 * which takes the transaction and the five-key allowlist the retired
 * owner-write member of `ProfilePorts` held.
 */
export const profilePorts = (db: Firestore): ProfilePorts => ({
  observeProfile: (userId) =>
    observeDoc<User>(doc(db, Collections.Users, userId)),

  loadProfile: (userId) => readDoc<User>(doc(db, Collections.Users, userId)),
});

/**
 * The staff client search over `users` (flip 2, plan §3.4, F2-15) — the
 * successor of the legacy search class adapter, WITHOUT its view model and
 * its query normalisation: `searchPrefixes array-contains prefix`, `orderBy
 * searchName`, at most `count` rows (index #8). The caller hands the prefix
 * already normalised (`SearchFieldsSystem.normalizeQuery`) and its own limit;
 * the rows are the stored `User` bodies, in the index's order — how a row is
 * named on screen is the caller's.
 */
export const userSearchPorts = (db: Firestore): UserSearchPorts => ({
  searchUsers: (prefix, count) =>
    readQuery<User>(
      query(
        collection(db, Collections.Users),
        where('searchPrefixes', 'array-contains', prefix),
        orderBy('searchName'),
        limit(count),
      ),
      Collections.Users,
    ),
});
