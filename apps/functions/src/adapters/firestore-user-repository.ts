import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { UserId } from '@creativo/domain/models';
import type { AccountStatus, User } from '@creativo/domain/accounts';
import {
  OtpDestination,
  ProvisionedUser,
  UserRecordSnapshot,
  UserRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { Result, fail, ok } from '@creativo/domain/kernel';

const COLLECTION = 'users';

function prefixesOf(token: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= token.length; i += 1) {
    out.push(token.slice(0, i));
  }
  return out;
}

/**
 * Standard Firestore "poor man's search" trick — every prefix of every
 * whitespace-split token in the full name, lowercased. MUST stay in
 * lockstep with the web's `FirestoreProfileAdapter.computeSearchFields`
 * (`libs/infrastructure/firestore/src/lib/profile.adapter.ts`): both sides
 * write the same `users/{uid}` document, and `FirestoreUserSearchAdapter`
 * queries these fields regardless of which side last wrote them.
 */
function computeSearchFields(fullName: string): {
  searchName: string;
  searchPrefixes: string[];
} {
  const searchName = fullName.trim().toLowerCase();
  const tokens = searchName.split(/\s+/).filter((t) => t.length > 0);
  const prefixSet = new Set<string>();
  for (const token of tokens) {
    for (const prefix of prefixesOf(token)) {
      prefixSet.add(prefix);
    }
  }
  return { searchName, searchPrefixes: [...prefixSet] };
}

function statusToPersistence(status: AccountStatus): DocumentData {
  if (status.kind === 'active') {
    return { kind: 'active' };
  }
  return {
    kind: 'blocked',
    reason: status.reason,
    untilIso: status.until ? status.until.toISO() : null,
  };
}

/**
 * The one persistence mapping for a REGISTERED user — field-for-field the
 * same document `FirestoreProfileAdapter.toPersistence` writes on the web
 * side (see `computeSearchFields`'s lockstep note above), so everything the
 * server registers reconstitutes cleanly through the web's profile door.
 */
function registeredToPersistence(user: User): DocumentData {
  const { searchName, searchPrefixes } = computeSearchFields(user.fullName());
  return {
    phone: user.phone.value,
    firstName: user.firstName.value,
    lastName: user.lastName.value,
    roles: [...user.roles],
    status: statusToPersistence(user.status),
    email: user.email ? user.email.value : null,
    birthDate: user.birthDate ? user.birthDate.toISODate() : null,
    searchName,
    searchPrefixes,
  };
}

function toSnapshot(
  id: string,
  data: DocumentData,
): Result<UserRecordSnapshot, RepositoryError> {
  const idResult = UserId.create(id);
  if (idResult.isFailure()) {
    return fail(new RepositoryError('Malformed user document', idResult.error));
  }
  const firstName = data['firstName'];
  return ok({
    id: idResult.value,
    email: typeof data['email'] === 'string' ? data['email'] : null,
    phone: typeof data['phone'] === 'string' ? data['phone'] : null,
    birthDate: typeof data['birthDate'] === 'string' ? data['birthDate'] : null,
    // Activation key: only `completeRegistration`'s accounts-shape write
    // ever sets `firstName` (the stub has just contact channels), and the
    // web profile editor can change but never blank it (`FirstName`'s
    // non-empty invariant) — so presence == registration completed.
    registered: typeof firstName === 'string' && firstName.trim().length > 0,
  });
}

export class FirestoreUserRepository implements UserRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async provision(
    user: ProvisionedUser,
  ): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.collection(COLLECTION).doc(user.id.value).set({
        email: user.email,
        phone: user.phone,
      });
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to provision user', error));
    }
  }

  async saveRegistered(user: User): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(user.id.value)
        .set(registeredToPersistence(user));
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save user', error));
    }
  }

  async findByDestination(
    destination: OtpDestination,
  ): Promise<Result<UserRecordSnapshot | null, RepositoryError>> {
    try {
      const field = destination.kind === 'email' ? 'email' : 'phone';
      const snapshot = await this.db
        .collection(COLLECTION)
        .where(field, '==', otpDestinationValue(destination))
        .limit(1)
        .get();
      if (snapshot.empty) {
        return ok(null);
      }
      const doc = snapshot.docs[0];
      if (!doc) {
        return ok(null);
      }
      return toSnapshot(doc.id, doc.data());
    } catch (error) {
      return fail(
        new RepositoryError('Failed to query user by destination', error),
      );
    }
  }
}
