import { InjectionToken } from '@angular/core';
import { Brand, Result } from '@creativo/domain/kernel';
import {
  Identifier,
  OtpCode,
  RegistrationField,
  SessionKind,
} from '@creativo/domain/identity';

export type OtpChallengeId = Brand<string, 'OtpChallengeId'>;

export class OtpClientError extends Error {
  constructor(
    message: string,
    public readonly userBlocked = false,
    public override readonly cause?: unknown,
    /**
     * The stable `errors.<code>` key off the callable's `HttpsError`
     * details — extracted by the adapter (the one place allowed to touch
     * `firebase/functions`), never by the feature store, so
     * `translateDomainError` is reachable from `type:feature` code without
     * a `firebase/*` import. Defaults to `'unknown'` when the failure
     * didn't carry a structured code (a network error, say).
     */
    public readonly code = 'unknown',
  ) {
    super(message);
  }
}

/**
 * The web app's callable-backed counterpart to `application/identity`'s
 * backend-only `OtpSenderPort`/`OtpRepositoryPort` — those exist purely
 * for `apps/functions`' own OTP use-cases; this is what `AuthFlow`'s
 * feature store actually calls. On a successful `verifyChallenge`, the
 * concrete adapter (Goal 04) is the one place that ever sees the raw
 * custom token — it signs the Firebase Auth SDK in immediately and the
 * token itself never crosses this port boundary.
 */
export interface OtpClient {
  requestChallenge(
    identifier: Identifier,
  ): Promise<Result<OtpChallengeId, OtpClientError>>;
  verifyChallenge(
    challengeId: OtpChallengeId,
    code: OtpCode,
  ): Promise<Result<SessionKind, OtpClientError>>;
  /** Finalizes a `new`-session sign-up with the deployment's required `AuthStrategy` fields. */
  completeRegistration(
    identifier: Identifier,
    fields: Partial<Record<RegistrationField, string>>,
  ): Promise<Result<void, OtpClientError>>;
}

export const OTP_CLIENT = new InjectionToken<OtpClient>('OtpClient');
