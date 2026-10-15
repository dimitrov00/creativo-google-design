import type { Firestore } from 'firebase-admin/firestore';
import { RepositoryError, Result, type UserId } from '@core/primitives';
import { Collections } from '@core/entities';
import type { AccountContact, IdentityPorts } from '@core/ports';

/**
 * The FIRST_BOOKING contact snapshot (flip 1, F1-5): `users/{uid}` of every
 * account a booking or an edit seats, in ONE non-transactional `getAll`,
 * read BEFORE the transaction opens — so `users/{uid}` never enters a
 * booking's conflict set (a stale name in a first-booking copy is
 * harmless). The body is spread as it is stored: `firstName`, `lastName`,
 * `phone` and `email` keep their names through every flip, and that is all
 * an `AccountContact` reads. An absent account is simply missing from the
 * map; a read that throws answers a `RepositoryError` value.
 */

/** The bundle main.ts spreads into the Firestore ports. */
export type AccountPorts = Pick<IdentityPorts, 'loadAccountContacts'>;

export const firestoreAccountPorts = (db: Firestore): AccountPorts => ({
  loadAccountContacts: async (userIds) => {
    const contacts = new Map<UserId, AccountContact>();
    const distinct = [...new Set(userIds)];
    // The Admin SDK refuses an empty `getAll`: nobody to read, nothing to ask.
    if (distinct.length === 0) return Result.ok(contacts);
    try {
      const snaps = await db.getAll(
        ...distinct.map((uid) => db.collection(Collections.Users).doc(uid)),
      );
      for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i];
        const uid = distinct[i];
        if (snap === undefined || uid === undefined || !snap.exists) continue;
        contacts.set(uid, snap.data() as AccountContact);
      }
      return Result.ok(contacts);
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(Collections.Users, String(error)),
      );
    }
  },
});
