import { Injectable, inject } from '@angular/core';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  OtpChallengeId,
  OtpClient,
  OtpClientError,
} from '@creativo/application/identity';
import {
  Identifier,
  OtpCode,
  RegistrationField,
  SessionKind,
  identifierChannelKey,
} from '@creativo/domain/identity';
import {
  FIREBASE_AUTH,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';

/** Local cast — `OtpChallengeId` has no exported factory (mirrors `toOtpCode` in `otp-code.ts`); this is the one legal boundary where a callable's raw response string becomes the brand. */
function toOtpChallengeId(raw: string): OtpChallengeId {
  return raw as OtpChallengeId;
}

interface RequestChallengeResponse {
  readonly challengeId: string;
}

interface VerifyChallengeResponse {
  readonly sessionKind: 'new' | 'returning';
  readonly customToken: string;
}

/**
 * The web app's callable-backed `OtpClient` (blueprint §6). `apps/functions`
 * does not implement these three callables yet (Phase 7 ports v2's OTP
 * use-cases onto the new domain) — the callable names below
 * (`requestOtpChallenge`/`verifyOtpChallenge`/`completeRegistration`) are
 * this adapter's contract with that future implementation.
 *
 * Per `otp-client.port.ts`'s own doc comment: on a successful
 * `verifyChallenge`, this is the ONE place that ever sees the raw custom
 * token — it signs the Firebase Auth SDK in immediately via
 * `signInWithCustomToken` and the token itself never crosses the port
 * boundary (only the resulting `SessionKind` does).
 */
@Injectable()
export class CallableOtpClient implements OtpClient {
  private readonly functions = inject(FIREBASE_FUNCTIONS);
  private readonly auth = inject(FIREBASE_AUTH);

  async requestChallenge(
    identifier: Identifier,
  ): Promise<Result<OtpChallengeId, OtpClientError>> {
    try {
      const callable = httpsCallable<
        { channelKey: string; kind: string; value: string },
        RequestChallengeResponse
      >(this.functions, 'requestOtpChallenge');
      const response = await callable({
        channelKey: identifierChannelKey(identifier),
        kind: identifier.kind,
        value: identifier.value.toString(),
      });
      return ok(toOtpChallengeId(response.data.challengeId));
    } catch (error) {
      return fail(
        new OtpClientError('Failed to request OTP challenge', false, error),
      );
    }
  }

  async verifyChallenge(
    challengeId: OtpChallengeId,
    code: OtpCode,
  ): Promise<Result<SessionKind, OtpClientError>> {
    try {
      const callable = httpsCallable<
        { challengeId: string; code: string },
        VerifyChallengeResponse
      >(this.functions, 'verifyOtpChallenge');
      const response = await callable({
        challengeId,
        code: code.value,
      });
      await signInWithCustomToken(this.auth, response.data.customToken);
      return ok(
        response.data.sessionKind === 'new'
          ? { kind: 'new' }
          : { kind: 'returning' },
      );
    } catch (error) {
      const userBlocked =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'functions/permission-denied';
      return fail(
        new OtpClientError(
          'Failed to verify OTP challenge',
          userBlocked,
          error,
        ),
      );
    }
  }

  async completeRegistration(
    identifier: Identifier,
    fields: Partial<Record<RegistrationField, string>>,
  ): Promise<Result<void, OtpClientError>> {
    try {
      const callable = httpsCallable<
        {
          channelKey: string;
          kind: string;
          value: string;
          fields: Partial<Record<RegistrationField, string>>;
        },
        void
      >(this.functions, 'completeRegistration');
      await callable({
        channelKey: identifierChannelKey(identifier),
        kind: identifier.kind,
        value: identifier.value.toString(),
        fields,
      });
      return ok(undefined);
    } catch (error) {
      return fail(
        new OtpClientError('Failed to complete registration', false, error),
      );
    }
  }
}
