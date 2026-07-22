import { DOCUMENT } from '@angular/common';
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

/**
 * Extracts the app-level `errors.<code>` key off a callable's `HttpsError`
 * details (duck-typed, not `instanceof FunctionsError` — the SDK's error
 * shape is stable across its versions, and this avoids importing the class
 * just for a type guard). `OtpClientError.code` is the only thing feature
 * stores ever read — never this raw `error`, which stays firebase-shaped
 * and infrastructure-only.
 */
function functionsErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return 'unknown';
  }
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null || !('code' in details)) {
    return 'unknown';
  }
  const code = (details as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'unknown';
}

interface RequestChallengeResponse {
  readonly challengeId: string;
  /** Emulator-only (`FUNCTIONS_EMULATOR==='true'` server-side) — never present in a real deployment, so stashing it unconditionally below is a production no-op, not a guarded dev path. */
  readonly devCode?: string;
}

interface E2eWindow extends Window {
  __e2eLastOtpCode?: string;
}

interface VerifyChallengeResponse {
  readonly sessionKind: 'new' | 'returning';
  readonly customToken: string;
}

interface CompleteRegistrationResponse {
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
  private readonly document = inject(DOCUMENT);

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
      if (response.data.devCode !== undefined) {
        const window = this.document.defaultView as E2eWindow | null;
        if (window) window.__e2eLastOtpCode = response.data.devCode;
      }
      return ok(toOtpChallengeId(response.data.challengeId));
    } catch (error) {
      return fail(
        new OtpClientError(
          'Failed to request OTP challenge',
          false,
          error,
          functionsErrorCode(error),
        ),
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
          functionsErrorCode(error),
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
        CompleteRegistrationResponse
      >(this.functions, 'completeRegistration');
      const response = await callable({
        channelKey: identifierChannelKey(identifier),
        kind: identifier.kind,
        value: identifier.value.toString(),
        fields,
      });
      // Re-signs in with the freshly-promoted-claims token rather than
      // relying on this session's *next* refresh to pick up the change —
      // see `CompleteRegistrationUseCase`'s own doc for why a mere refresh
      // isn't reliable against the Auth emulator.
      await signInWithCustomToken(this.auth, response.data.customToken);
      return ok(undefined);
    } catch (error) {
      return fail(
        new OtpClientError(
          'Failed to complete registration',
          false,
          error,
          functionsErrorCode(error),
        ),
      );
    }
  }
}
