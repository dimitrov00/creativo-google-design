import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { Otp, OtpId } from '@creativo/domain/models';
import {
  OtpDestination,
  OtpRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';

const COLLECTION = 'otps';

function toPersistence(otp: Otp): DocumentData {
  return {
    tenantId: otp.tenantId.value,
    destination: otp.destination,
    destinationType: otp.destinationType,
    purpose: otp.purpose,
    codeHash: otp.codeHash,
    salt: otp.salt,
    expiresAt: otp.expiresAt.toISO(),
    attemptCount: otp.attemptCount,
    maxAttempts: otp.maxAttempts,
    consumedAt: otp.consumedAt ? otp.consumedAt.toISO() : null,
    createdAt: otp.createdAt.toISO(),
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<Otp, RepositoryError> {
  const reconstituted = Otp.reconstitute({
    id,
    tenantId: data['tenantId'],
    destination: data['destination'],
    destinationType: data['destinationType'],
    purpose: data['purpose'],
    codeHash: data['codeHash'],
    salt: data['salt'],
    expiresAtIso: data['expiresAt'],
    attemptCount: data['attemptCount'],
    maxAttempts: data['maxAttempts'],
    consumedAtIso: data['consumedAt'] ?? null,
    createdAtIso: data['createdAt'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed OTP document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

export class FirestoreOtpRepository implements OtpRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async save(otp: Otp): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(otp.id.value)
        .set(toPersistence(otp));
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save OTP', error));
    }
  }

  async findById(id: OtpId): Promise<Result<Otp | null, RepositoryError>> {
    try {
      const snapshot = await this.db.collection(COLLECTION).doc(id.value).get();
      if (!snapshot.exists) {
        return ok(null);
      }
      const data = snapshot.data();
      if (!data) {
        return ok(null);
      }
      return toDomain(id.value, data);
    } catch (error) {
      return fail(new RepositoryError('Failed to read OTP', error));
    }
  }

  async findRecentUnconsumedByDestination(
    destination: OtpDestination,
    since: ZonedDateTime,
  ): Promise<Result<boolean, RepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(COLLECTION)
        .where('destination', '==', otpDestinationValue(destination))
        .where('consumedAt', '==', null)
        .where('createdAt', '>=', since.toISO())
        .limit(1)
        .get();
      return ok(!snapshot.empty);
    } catch (error) {
      return fail(new RepositoryError('Failed to query recent OTPs', error));
    }
  }
}
