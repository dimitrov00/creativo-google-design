import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirebaseAuthTokenAdapter } from '../../adapters/firebase-auth-token-adapter';
import { FirestoreUserRepository } from '../../adapters/firestore-user-repository';
import { SystemClock } from '../../adapters/system-clock';
import { adminAuth, adminFirestore } from '../firebase-admin';
import { CompleteRegistrationError } from '../../use-cases/complete-registration.errors';
import { CompleteRegistrationUseCase } from '../../use-cases/complete-registration.use-case';

export function toHttpsError(error: CompleteRegistrationError): HttpsError {
  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'invalid_input':
    case 'registration_field_missing':
      return new HttpsError('invalid-argument', error.message, details);
    case 'registration_unauthenticated':
      return new HttpsError('unauthenticated', error.message, details);
    case 'registration_forbidden':
      // NOT 'permission-denied': `CallableOtpClient` reads that code as
      // the OTP lockout (`userBlocked`) and the auth flow would render the
      // blocked terminal — a uid mismatch is a different failure.
      return new HttpsError('failed-precondition', error.message, details);
    case 'registration_user_not_found':
      return new HttpsError('failed-precondition', error.message, details);
    case 'user_validation_failed':
      return new HttpsError('invalid-argument', error.message, {
        errors: error.errors.map((e) => ({ code: e.code, params: e.params })),
      });
    case 'registration_birth_date_invalid':
      // Forward the domain VO's reason-specific stable code
      // (`identity.birth_date.*`) so the client localizes the actual
      // problem, not a generic wrapper — same shape as
      // `user_validation_failed` above.
      return new HttpsError('invalid-argument', error.message, {
        code: error.code,
        errors: [{ code: error.cause.code, params: error.cause.params }],
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
    new SystemClock(),
  );

  // `request.auth` is the verified session `verifyOtpChallenge`'s custom
  // token signed in — registration is bound to that uid, never to whatever
  // identifier the payload claims.
  const result = await useCase.execute(request.data, request.auth?.uid ?? null);
  return match(result, {
    success: (value) => ({ customToken: value.customToken }),
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
