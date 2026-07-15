import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirebaseAuthTokenAdapter } from '../../adapters/firebase-auth-token-adapter';
import { FirestoreOtpRepository } from '../../adapters/firestore-otp-repository';
import { FirestoreUserRepository } from '../../adapters/firestore-user-repository';
import { NodeOtpCrypto } from '../../adapters/node-otp-crypto';
import { SystemClock } from '../../adapters/system-clock';
import { adminAuth, adminFirestore } from '../firebase-admin';
import {
  UserValidationFailure,
  VerifyOtpError,
} from '../../use-cases/verify-otp.errors';
import { VerifyOtpUseCase } from '../../use-cases/verify-otp.use-case';

export function toHttpsError(error: VerifyOtpError): HttpsError {
  if (error instanceof UserValidationFailure) {
    return new HttpsError('invalid-argument', error.message, {
      errors: error.errors.map((e) => ({ code: e.code, params: e.params })),
    });
  }

  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'invalid_input':
      return new HttpsError('invalid-argument', error.message, details);
    case 'otp_not_found':
      return new HttpsError('not-found', error.message, details);
    case 'otp_already_consumed':
      return new HttpsError('failed-precondition', error.message, details);
    case 'otp_expired':
      return new HttpsError('deadline-exceeded', error.message, details);
    case 'otp_locked_out':
      return new HttpsError('resource-exhausted', error.message, details);
    case 'otp_incorrect_code':
      return new HttpsError('invalid-argument', error.message, details);
    default:
      return new HttpsError('internal', error.message, details);
  }
}

export const verifyOtp = onCall(async (request) => {
  const db = adminFirestore();
  const crypto = new NodeOtpCrypto();
  const useCase = new VerifyOtpUseCase(
    new FirestoreOtpRepository(db),
    new FirestoreUserRepository(db),
    new FirebaseAuthTokenAdapter(adminAuth()),
    new SystemClock(),
    crypto,
  );

  const result = await useCase.execute(request.data);
  return match(result, {
    success: (value) => value,
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
