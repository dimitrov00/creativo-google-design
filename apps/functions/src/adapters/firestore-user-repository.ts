import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { SearchFieldsSystem } from '@core/systems';
import { UserId } from '@creativo/domain/models';
import type { User } from '@creativo/domain/accounts';
import {
  OtpDestination,
  ProvisionedUser,
  StoredAccountStatus,
  UserRecordSnapshot,
  UserRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import {
  RepositoryError,
  accountStatusFromDocument,
  accountStatusToDocument,
} from '@creativo/application/shared';
import { Result, fail, ok } from '@creativo/domain/kernel';

const COLLECTION = 'users';

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
 * The one persistence mapping for a REGISTERED user — the whole document
 * the web's profile door (`FirestoreProfileAdapter`) reads back, so
 * everything the server registers reconstitutes cleanly there. The web
 * never writes this shape itself: it creates no `users` document and
 * updates only the owner's allowlist (names, birth date, search keys — see
 * `computeSearchFields` above — one system for both writers).
 */
function registeredToPersistence(user: User): DocumentData {
  const { searchName, searchPrefixes } = computeSearchFields(
    user.fullName(),
    [user.phone.value, user.phone.formatNational()],
    user.email ? user.email.value : null,
  );
  return {
    phone: user.phone.value,
    firstName: user.firstName.value,
    lastName: user.lastName.value,
    roles: [...user.roles],
    status: accountStatusToDocument(user.status),
    email: user.email ? user.email.value : null,
    birthDate: user.birthDate ? user.birthDate.toISODate() : null,
    searchName,
    searchPrefixes,
  };
}

/** `absent` on a stub; otherwise the shared mapper's verdict, never a guess. */
function storedStatusOf(raw: unknown): StoredAccountStatus {
  if (raw === undefined || raw === null) return { kind: 'absent' };
  const parsed = accountStatusFromDocument(raw);
  return parsed.isSuccess()
    ? { kind: 'stored', status: parsed.value }
    : { kind: 'unreadable' };
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
  const roles = Array.isArray(data['roles'])
    ? data['roles'].filter((role): role is string => typeof role === 'string')
    : [];
  return ok({
    id: idResult.value,
    // Empty means "stub or pre-roles doc" — the mint site falls back to
    // `client`, never to nothing.
    roles,
    status: storedStatusOf(data['status']),
    email: typeof data['email'] === 'string' ? data['email'] : null,
    phone: typeof data['phone'] === 'string' ? data['phone'] : null,
    birthDate: typeof data['birthDate'] === 'string' ? data['birthDate'] : null,
    // Activation key: only `completeRegistration`'s accounts-shape write
    // ever sets `firstName` (the stub has just contact channels). The rules
    // let the owner edit it only once the STORED document already has one,
    // and never to fewer than `FIRST_NAME_MIN_LENGTH` characters — so
    // presence == registration completed. Even a blanked name could not
    // reset a pause: the registration re-run carries `status` forward.
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
