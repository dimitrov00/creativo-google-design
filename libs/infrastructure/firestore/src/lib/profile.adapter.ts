import { Injectable, inject } from '@angular/core';
import { SearchFieldsSystem } from '@core/systems';
import { Observable } from 'rxjs';
import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';
import { getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ProfilePort } from '@creativo/application/accounts';
import {
  RepositoryError,
  accountStatusFromDocument,
} from '@creativo/application/shared';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { User, UserId } from '@creativo/domain/accounts';
import { userDocRef } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/** `User.create`/`.reconstitute` require a `today: ZonedDateTime` — there is
 * no `CLOCK` port wired into `libs/infrastructure` in this phase, so it's
 * computed inline here. Only used for zone-consistent birth-date parsing;
 * age re-validation is skipped on reconstitute regardless (see
 * `BirthDate.reconstitute`). Revisit once a `CLOCK` adapter exists. */
function todayInAppZone(): ZonedDateTime {
  const result = ZonedDateTime.now('Europe/Sofia');
  if (result.isFailure()) {
    // 'Europe/Sofia' is a hard-coded, always-valid IANA zone — unreachable.
    throw new Error('Unreachable: Europe/Sofia is always a valid zone');
  }
  return result.value;
}

/**
 * The `users/{uid}` search keys (`searchName`, `searchPrefixes`) — Phase 2
 * shim (ECS migration): computed by `SearchFieldsSystem.fromForms`
 * (`@core/systems`), the ONE implementation the web's profile adapter
 * and the functions' user repository share, so the two writers of the
 * document can no longer drift apart.
 */
function computeSearchFields(
  fullName: string,
  phoneForms: readonly string[] = [],
  email: string | null = null,
): {
  searchName: string;
  searchPrefixes: string[];
} {
  const { searchName, searchPrefixes } = SearchFieldsSystem.fromForms(
    fullName,
    phoneForms,
    email,
  );
  return { searchName, searchPrefixes: [...searchPrefixes] };
}

/**
 * The keys the owner may write, and the ONLY keys `saveProfile` sends — the
 * `users` owner-update allowlist in `firestore.rules` (FIX 2), verbatim.
 * Everything else on the document is server-written: roles and status by
 * the Admin SDK, phone and email by the OTP contact change.
 */
type OwnerEditableKey =
  'firstName' | 'lastName' | 'birthDate' | 'searchName' | 'searchPrefixes';

/**
 * The edited names and birth date, and the search keys they change.
 *
 * `searchPrefixes` mixes name, phone and email prefixes in one field, so a
 * name edit rewrites all of it — from the STORED contact channels, never the
 * caller's: this write cannot change phone or email, so it must not index
 * ones the document does not hold.
 */
function ownerEditsOf(
  edited: User,
  stored: User,
): Readonly<Record<OwnerEditableKey, unknown>> {
  const { searchName, searchPrefixes } = computeSearchFields(
    edited.fullName(),
    [stored.phone.value, stored.phone.formatNational()],
    stored.email ? stored.email.value : null,
  );
  return {
    firstName: edited.firstName.value,
    lastName: edited.lastName.value,
    birthDate: edited.birthDate ? edited.birthDate.toISODate() : null,
    searchName,
    searchPrefixes,
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<User, RepositoryError> {
  const statusResult = accountStatusFromDocument(data['status']);
  if (statusResult.isFailure()) {
    return fail(statusResult.error);
  }
  const reconstituted = User.reconstitute(
    {
      id,
      phone: data['phone'],
      firstName: data['firstName'],
      lastName: data['lastName'],
      roles: Array.isArray(data['roles']) ? data['roles'] : [],
      status: statusResult.value,
      email: data['email'] ?? undefined,
      birthDate: data['birthDate'] ?? undefined,
    },
    todayInAppZone(),
  );
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed user document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

/**
 * A stored `users/{uid}` read as a profile: `null` while it is absent or
 * still `verifyOtp`'s contact-only stub. Registration is the only writer of
 * `firstName`, so its presence is "registered" — the same activation key the
 * functions' `FirestoreUserRepository` reads.
 */
function profileFrom(
  snapshot: DocumentSnapshot,
): Result<User | null, RepositoryError> {
  if (!snapshot.exists()) {
    return ok(null);
  }
  const data = snapshot.data() ?? {};
  const firstName = data['firstName'];
  if (typeof firstName !== 'string' || firstName.trim().length === 0) {
    return ok(null);
  }
  try {
    return toDomain(snapshot.id, data);
  } catch (error) {
    // Value-object doors assume strings; a hand-edited document can hand
    // them anything. Never let that escape a snapshot callback.
    return fail(new RepositoryError('Malformed user document', error));
  }
}

/** Direct Firestore adapter (not callable-backed) for `ProfilePort` —
 * `users/{uid}` rules let the owner read the document and update the
 * allowlisted profile fields (never `roles`/`status`/`phone`/`email`), so
 * profile reads/writes don't need server round-tripping. The document
 * itself is created server-side, by `verifyOtp` and registration. */
@Injectable()
export class FirestoreProfileAdapter implements ProfilePort {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async getProfile(
    userId: UserId,
  ): Promise<Result<User | null, RepositoryError>> {
    try {
      return profileFrom(await getDoc(userDocRef(this.db, userId)));
    } catch (error) {
      return fail(new RepositoryError('Failed to load user profile', error));
    }
  }

  observeProfile(
    userId: UserId,
  ): Observable<Result<User | null, RepositoryError>> {
    const ref = userDocRef(this.db, userId);
    return subscribeWithRetry<User | null>((onNext, onError) =>
      onSnapshot(
        ref,
        (snapshot) => {
          const result = profileFrom(snapshot);
          if (result.isFailure()) {
            onError(result.error);
            return;
          }
          onNext(result.value);
        },
        onError,
      ),
    );
  }

  /**
   * An update of the allowlisted keys only, never a whole-document set: a
   * set re-sends every server-written field, so the first one this mapper
   * does not round-trip (a pause's extra `status` fields) would make the
   * owner's next name edit fail the rules — or quietly erase it.
   *
   * A transaction because the search keys are derived from the stored phone
   * and email (`ownerEditsOf`), which a contact change may move meanwhile.
   */
  async saveProfile(user: User): Promise<Result<void, RepositoryError>> {
    const ref = userDocRef(this.db, user.id);
    try {
      return await runTransaction(this.db, async (transaction) => {
        const stored = profileFrom(await transaction.get(ref));
        if (stored.isFailure()) {
          return fail(stored.error);
        }
        if (stored.value === null) {
          return fail(
            new RepositoryError(
              'No registered profile to update: registration creates it',
            ),
          );
        }
        transaction.update(ref, { ...ownerEditsOf(user, stored.value) });
        return ok(undefined);
      });
    } catch (error) {
      return fail(new RepositoryError('Failed to save user profile', error));
    }
  }
}
