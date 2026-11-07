import type { Firestore } from 'firebase-admin/firestore';
import { IdentifierChannel, Result } from '@core/primitives';
import { Collections, type User } from '@core/entities';
import type { ProfileLoadPorts, UserLookupPorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The account holding a sign-in destination (identity flip (2), blueprint
 * §4.1 `verifyOtp`, `completeRegistration`) — the single-field users query
 * `where('phone' | 'email', '==', identifier).limit(1)`, the field picked
 * by the parsed destination's `identifierChannel` (no composite index). The
 * body is spread as stored — the flat `User` minus `id`, a `PROVISIONED`
 * stub included: what the account's registration state means is the
 * pipeline's (`RegistrationSystem`), never this file's. Beside it the
 * account by id, `users/{uid}` (`loadProfile`, `null` when absent) — the
 * staff analytics caller read; `users` is not a guarded collection.
 *
 * `users/{uid}` is WRITTEN only inside a `CommitPlan` (the stub `Create`,
 * the registered `Set`, the `updateProfile` `Update`), never here. A read
 * that throws answers a `RepositoryError` value whose `reason` is the
 * failure's canonical code.
 */

export const firestoreUserPorts = (
  db: Firestore,
): UserLookupPorts & ProfileLoadPorts => ({
  loadProfile: async (userId) => {
    const path = `${Collections.Users}/${userId}`;
    try {
      const snap = await db.collection(Collections.Users).doc(userId).get();
      return Result.ok(
        snap.exists ? ({ id: snap.id, ...snap.data() } as User) : null,
      );
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
  },

  findUserByDestination: async (destination) => {
    try {
      const snap = await db
        .collection(Collections.Users)
        .where(
          destination.identifierChannel === IdentifierChannel.Phone
            ? 'phone'
            : 'email',
          '==',
          destination.identifier,
        )
        .limit(1)
        .get();
      const doc = snap.docs[0];
      return Result.ok(
        doc === undefined ? null : ({ id: doc.id, ...doc.data() } as User),
      );
    } catch (error) {
      return Result.err(readFailed(Collections.Users, error));
    }
  },
});
