import type { Observable } from 'rxjs';
import type {
  OtpCode,
  ParsedIdentifier,
  Principal,
  RegistrationFields,
  SessionKind,
} from '@core/components';
import type { Result, OtpId } from '@core/primitives';
import type { PipelineError } from '@core/errors';

/**
 * The web's authentication ports (blueprint §4.2) — the Firebase Auth
 * session and the three OTP callables. Every failure is the one
 * `PipelineError` taxonomy; the server's own `errorCode` (an identity or
 * account refusal) rides along in it for the UI to word.
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

/**
 * The signed-in identifier on the session, its channel riding with it (a
 * phone wins over an e-mail when the session holds both — today's reading);
 * `null` when signed out.
 */
export type CurrentIdentifier = () => ParsedIdentifier | null;

/** The Auth profile's display name; `null` when signed out or never set. */
export type CurrentDisplayName = () => string | null;

// ── The OTP callables ─────────────────────────────────────────────────────

/** `requestOtpChallenge` — issue a code to the identifier; answers the challenge id. */
export type RequestOtpChallenge = (
  identifier: ParsedIdentifier,
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
  identifier: ParsedIdentifier,
  fields: RegistrationFields,
) => Promise<Result<void, PipelineError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The Firebase Auth session — `AUTH_SESSION_PORTS` / `authSessionPorts(auth)`. */
export type AuthSessionPorts = {
  readonly observePrincipal: ObservePrincipal;
  readonly refreshToken: RefreshToken;
  readonly signOut: SignOut;
  readonly currentIdentifier: CurrentIdentifier;
  readonly currentDisplayName: CurrentDisplayName;
};

/** The three OTP callables — `OTP_CHALLENGE_PORTS` / `otpChallengePorts(auth, gateway)`. */
export type OtpChallengePorts = {
  readonly requestOtpChallenge: RequestOtpChallenge;
  readonly verifyOtpChallenge: VerifyOtpChallenge;
  readonly completeRegistration: CompleteRegistration;
};

/** The whole authentication suite — an intersection of its bundles. */
export type AuthPorts = AuthSessionPorts & OtpChallengePorts;
