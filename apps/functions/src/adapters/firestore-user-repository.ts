import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import {
  OtpDestinationType,
  RepositoryError,
  User,
  UserRepositoryPort,
} from '@creativo/domain/models';
import { Result, fail, ok } from '@creativo/domain/kernel';

const COLLECTION = 'users';

function toPersistence(user: User): DocumentData {
  return {
    displayName: user.displayName,
    email: user.email?.value ?? null,
    phone: user.phone,
    referralCode: user.referralCode,
    gamificationPoints: user.gamificationPoints,
    tenantMemberships: user.tenantMemberships.map((m) => ({
      tenantId: m.tenantId.value,
      role: m.role,
    })),
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<User, RepositoryError> {
  const reconstituted = User.reconstitute({
    id,
    displayName: data['displayName'] ?? undefined,
    email: data['email'] ?? undefined,
    phone: data['phone'] ?? undefined,
    referralCode: data['referralCode'],
    gamificationPoints: data['gamificationPoints'],
    tenantMemberships: Array.isArray(data['tenantMemberships'])
      ? data['tenantMemberships']
      : [],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed user document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

export class FirestoreUserRepository implements UserRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async save(user: User): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(user.id.value)
        .set(toPersistence(user));
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save user', error));
    }
  }

  async findByDestination(
    destination: string,
    destinationType: OtpDestinationType,
  ): Promise<Result<User | null, RepositoryError>> {
    try {
      const field = destinationType === 'email' ? 'email' : 'phone';
      const snapshot = await this.db
        .collection(COLLECTION)
        .where(field, '==', destination)
        .limit(1)
        .get();
      if (snapshot.empty) {
        return ok(null);
      }
      const doc = snapshot.docs[0];
      if (!doc) {
        return ok(null);
      }
      return toDomain(doc.id, doc.data());
    } catch (error) {
      return fail(
        new RepositoryError('Failed to query user by destination', error),
      );
    }
  }
}
