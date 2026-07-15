import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { ConsoleLogOtpSender } from '../../adapters/console-otp-sender';
import { FirestoreOtpRepository } from '../../adapters/firestore-otp-repository';
import { NodeOtpCrypto } from '../../adapters/node-otp-crypto';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import {
  RequestOtpError,
  ValidationFailure,
} from '../../use-cases/request-otp.errors';
import { RequestOtpUseCase } from '../../use-cases/request-otp.use-case';

export function toHttpsError(error: RequestOtpError): HttpsError {
  if (error instanceof ValidationFailure) {
    return new HttpsError('invalid-argument', error.message, {
      errors: error.errors.map((e) => ({ code: e.code, params: e.params })),
    });
  }

  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'invalid_input':
      return new HttpsError('invalid-argument', error.message, details);
    case 'otp_rate_limited':
      return new HttpsError('resource-exhausted', error.message, details);
    default:
      return new HttpsError('internal', error.message, details);
  }
}

export const requestOtp = onCall(async (request) => {
  const crypto = new NodeOtpCrypto();
  const useCase = new RequestOtpUseCase(
    new FirestoreOtpRepository(adminFirestore()),
    new ConsoleLogOtpSender(),
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
