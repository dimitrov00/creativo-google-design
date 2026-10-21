import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { Result } from '@core/primitives';
import { Collections, type User } from '@core/entities';
import type { ProfilePorts, UserSearchPorts } from '@core/ports';
import {
  entityOf,
  observeDoc,
  readDoc,
  readQuery,
  writeFailed,
} from './observe';

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
 * The owner's write (`writeOwnProfile`, F2-6) is ONE transaction: read the
 * document, hand it to the caller's `decide` (`ProfileEditSystem.decide`
 * bound to the edits and the age day — the one profile-edit rule, shared
 * with the server's `updateProfile`), then `update` the five owner keys it
 * answers. Never a whole-document set: a set re-sends every server-written
 * key (`roles`, `accountStatus`, a block's `blockReason` /
 * `blockedUntilUtcMs`, the contact channels) and the rules' owner allowlist
 * refuses it. A transaction because the search keys are derived from the
 * STORED phone and e-mail, which a contact change may move meanwhile. The
 * document itself is created server-side only (`verifyOtp`'s stub,
 * `completeRegistration`'s body).
 */
export const profilePorts = (db: Firestore): ProfilePorts => ({
  observeProfile: (userId) =>
    observeDoc<User>(doc(db, Collections.Users, userId)),

  loadProfile: (userId) => readDoc<User>(doc(db, Collections.Users, userId)),

  writeOwnProfile: async (userId, decide) => {
    const ref = doc(db, Collections.Users, userId);
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        const decided = decide(
          data === undefined ? null : entityOf<User>(snap.id, data),
        );
        if (!decided.ok) return decided;
        if (decided.value !== null) {
          // The five keys of `OwnerProfileFields` — the rules' owner
          // allowlist, verbatim — and nothing else the answer may carry.
          const { firstName, lastName, birthDate, searchName, searchPrefixes } =
            decided.value;
          tx.update(ref, {
            firstName,
            lastName,
            birthDate,
            searchName,
            searchPrefixes,
          });
        }
        return Result.ok(undefined);
      });
    } catch (cause) {
      return Result.err(writeFailed(ref.path, cause));
    }
  },
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
