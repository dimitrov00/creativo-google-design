import { type Auth, signInWithCustomToken } from 'firebase/auth';
import { Result } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import {
  Callables,
  type GatewayPorts,
  type OtpChallengePorts,
} from '@core/ports';

/** The e2e suite's window hook — the emulator's code, stashed for the OTP screen's journey. */
type E2eWindow = Window & { __e2eLastOtpCode?: string };

/** Signs the browser in with a just-minted custom token; a refusal is no session. */
async function signInWith(
  auth: Auth,
  customToken: string,
): Promise<Result<void, PipelineError>> {
  try {
    await signInWithCustomToken(auth, customToken);
    return Result.ok(undefined);
  } catch {
    return Result.err(PipelineError.bare(PipelineErrorCode.Unknown));
  }
}

/**
 * THE THREE OTP CALLABLES as the web's `OtpChallengePorts` (Phase 4a §3.10;
 * the closure successor of the retired OTP-client class), dialled through the
 * ONE typed callable client (`gateway.callableClient`): its request is the
 * identity call component, its answer decoded by `IdentityCall`'s decoders, its
 * failure the one `PipelineError` classification — a blocked person is
 * `PipelineError.isBlocked` (the wire STATUS, as today).
 *
 * The one thing it adds is the browser half of a sign-in: a verify or a
 * registration answers a custom token, which this signs Firebase Auth in
 * with at once (`signInWithCustomToken`) — the token itself never crosses
 * the port. A registration re-signs in with the freshly promoted claims
 * rather than waiting for the session's next refresh, which is not
 * reliable against the Auth emulator. A sign-in that fails is
 * `PIPELINE_UNKNOWN`.
 *
 * The emulator answers a request with its code (`devCode`); it is stashed
 * on `window.__e2eLastOtpCode` for the e2e suite — `null` in every real
 * deployment, so the stash is a production no-op, not a guarded dev path.
 */
export const otpChallengePorts = (
  auth: Auth,
  gateway: GatewayPorts,
  document: Document,
): OtpChallengePorts => ({
  requestOtpChallenge: async (identifier) => {
    const answer = await gateway.callableClient(Callables.RequestOtpChallenge)(
      identifier,
    );
    if (!answer.ok) return answer;
    const view: E2eWindow | null = document.defaultView;
    if (answer.value.devCode !== null && view !== null) {
      view.__e2eLastOtpCode = answer.value.devCode;
    }
    return Result.ok(answer.value.challengeId);
  },

  verifyOtpChallenge: async (challengeId, code) => {
    const answer = await gateway.callableClient(Callables.VerifyOtpChallenge)({
      challengeId,
      code,
    });
    if (!answer.ok) return answer;
    const signedIn = await signInWith(auth, answer.value.customToken);
    return signedIn.ok ? Result.ok(answer.value.sessionKind) : signedIn;
  },

  completeRegistration: async (identifier, fields) => {
    const answer = await gateway.callableClient(Callables.CompleteRegistration)(
      { ...identifier, fields },
    );
    if (!answer.ok) return answer;
    return signInWith(auth, answer.value.customToken);
  },
});
