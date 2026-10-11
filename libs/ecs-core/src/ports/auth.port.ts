import type { Observable } from 'rxjs';
import type { Identifier } from '../components/identifier.data';
import type { OtpCode } from '../components/otp-code.data';
import type { PipelineError } from '../components/pipeline-errors.data';
import type { Principal } from '../components/principal.data';
import type { RegistrationFields } from '../components/registration.data';
import type { Result } from '../components/result.data';
import type { SessionKind } from '../components/session-kind.data';
import type { OtpId } from '../primitives/ids.primitive';

/**
 * The web's authentication ports (blueprint §4.2) — the Firebase Auth
 * session (`AuthGateway`) and the three OTP callables (`OtpClient`). Every
 * failure is the one `PipelineError` taxonomy; the server's own code (the
 * wire's `identity.otp.wrong_code` until Phase 4, an account refusal) rides
 * along in it for the UI to word.
 */

// ── The session ───────────────────────────────────────────────────────────

/**
 * Who is signed in, live. Never an error: a session that cannot be read
 * degrades to `Principal.anonymous()` (claims without a tenant to
 * `onboarding`), the safe answer `Principal.fromClaims` already gives.
 */
export type ObservePrincipal = () => Observable<Principal>;

/** Force a fresh ID token — after the claims changed server-side. */
export type RefreshToken = () => Promise<Result<void, PipelineError>>;

export type SignOut = () => Promise<Result<void, PipelineError>>;

/** The signed-in identifier (phone or e-mail) on the session; `null` when signed out. */
export type CurrentIdentifier = () => Identifier | null;

/** The Auth profile's display name; `null` when signed out or never set. */
export type CurrentDisplayName = () => string | null;

// ── The OTP callables ─────────────────────────────────────────────────────

/** `requestOtpChallenge` — issue a code to the identifier; answers the challenge id. */
export type RequestOtpChallenge = (
  identifier: Identifier,
) => Promise<Result<OtpId, PipelineError>>;

/**
 * `verifyOtpChallenge` — check the typed code and sign in; answers which
 * session it opened (`SessionKind`, §9 D22/D28 — the one field the response
 * gains).
 */
export type VerifyOtpChallenge = (
  challengeId: OtpId,
  code: OtpCode,
) => Promise<Result<SessionKind, PipelineError>>;

/**
 * `completeRegistration` — the about step's fields, every key present
 * (`null` for one the form did not collect).
 */
export type CompleteRegistration = (
  identifier: Identifier,
  fields: RegistrationFields,
) => Promise<Result<void, PipelineError>>;

/** The authentication bundle the web binds. */
export type AuthPorts = {
  readonly observePrincipal: ObservePrincipal;
  readonly refreshToken: RefreshToken;
  readonly signOut: SignOut;
  readonly currentIdentifier: CurrentIdentifier;
  readonly currentDisplayName: CurrentDisplayName;
  readonly requestOtpChallenge: RequestOtpChallenge;
  readonly verifyOtpChallenge: VerifyOtpChallenge;
  readonly completeRegistration: CompleteRegistration;
};
