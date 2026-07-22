import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { ConsoleLogOtpSender } from '../../adapters/console-otp-sender';
import { FirestoreOtpRepository } from '../../adapters/firestore-otp-repository';
import { NodeOtpCrypto } from '../../adapters/node-otp-crypto';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import { DEFAULT_TENANT_ID } from './tenant';
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

/**
 * `libs/infrastructure/firebase-auth`'s `CallableOtpClient` — the fixed
 * wire contract this callable must match — sends `Identifier`'s own shape
 * (`channelKey`/`kind`/`value`), not `RequestOtpUseCase`'s destination
 * vocabulary; `channelKey` itself is redundant here (the use-case derives
 * its own rate-limit dedup key from `destination`), so only `kind`/`value`
 * carry through. Single-tenant deployment (blueprint §0.4's greenfield
 * schema freedom) — `DEFAULT_TENANT_ID` stands in for a real tenant-config
 * lookup, which is out of scope for this slice.
 */
interface RequestOtpChallengeInput {
  readonly channelKey?: unknown;
  readonly kind: 'phone' | 'email';
  readonly value: string;
}

export const requestOtpChallenge = onCall(async (request) => {
  const crypto = new NodeOtpCrypto();
  const useCase = new RequestOtpUseCase(
    new FirestoreOtpRepository(adminFirestore()),
    new ConsoleLogOtpSender(),
    new SystemClock(),
    crypto,
  );

  const input = request.data as RequestOtpChallengeInput;
  const result = await useCase.execute({
    tenantId: DEFAULT_TENANT_ID,
    destination: input?.value,
    destinationType: input?.kind === 'phone' ? 'sms' : 'email',
    purpose: 'login',
  });
  return match(result, {
    // `devCode` only ever leaves the emulator — there is no SMS/email
    // inbox for E2E to read the real code from otherwise. `ConsoleLogOtpSender`
    // already logs it server-side regardless; this just makes it
    // reachable from the Playwright test process too.
    success: (value) => ({
      challengeId: value.otpId,
      ...(process.env['FUNCTIONS_EMULATOR'] === 'true'
        ? { devCode: value.rawCode }
        : {}),
    }),
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
