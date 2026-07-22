import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirebaseAuthTokenAdapter } from '../../adapters/firebase-auth-token-adapter';
import { FirestoreUserRepository } from '../../adapters/firestore-user-repository';
import { adminAuth, adminFirestore } from '../firebase-admin';
import { CompleteRegistrationError } from '../../use-cases/complete-registration.errors';
import { CompleteRegistrationUseCase } from '../../use-cases/complete-registration.use-case';

export function toHttpsError(error: CompleteRegistrationError): HttpsError {
  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'invalid_input':
    case 'registration_field_missing':
      return new HttpsError('invalid-argument', error.message, details);
    case 'registration_user_not_found':
      return new HttpsError('failed-precondition', error.message, details);
    case 'user_validation_failed':
      return new HttpsError('invalid-argument', error.message, {
        errors: error.errors.map((e) => ({ code: e.code, params: e.params })),
      });
    default:
      return new HttpsError('internal', error.message, details);
  }
}

export const completeRegistration = onCall(async (request) => {
  const db = adminFirestore();
  const useCase = new CompleteRegistrationUseCase(
    new FirestoreUserRepository(db),
    new FirebaseAuthTokenAdapter(adminAuth()),
  );

  const result = await useCase.execute(request.data);
  return match(result, {
    success: (value) => ({ customToken: value.customToken }),
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
