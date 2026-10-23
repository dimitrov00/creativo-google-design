import type { Auth } from 'firebase-admin/auth';
import { IdentifierChannel, Result, UserId } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { AuthClaims } from '@core/components';
import type { AuthAdminPorts, AuthUserLookupPorts } from '@core/ports';
import { AttemptOutcome, TriggerAttemptSystem } from '@core/systems';

/**
 * The Admin-Auth bundles of `identity.port.ts` over `firebase-admin/auth`
 * (Law 9 — the factory returns the `&` of the two bundles it serves, never
 * a local record): `AuthAdminPorts` — the Auth user of a first
 * verification (`provisionAuthUser`), custom-token minting, custom claims
 * and the Auth user's display name — and `AuthUserLookupPorts` — the Auth
 * user holding a destination (`findAuthUserByDestination`), which resolves
 * the first-verification race's winner or an orphan Auth user (blueprint
 * §4.1 `verifyOtp`, F2-9).
 *
 * The claims bag written on the token is the component's own stored shape,
 * `AuthClaims.toToken` — the adapter maps nothing, and the token shape has
 * one source of truth beside `AuthClaims.fromToken`.
 */

/** The Admin SDK's refusal codes this adapter answers as values. */
const AuthRefusal = {
  /** `createUser` on a phone another Auth user holds — the race loser. */
  PhoneTaken: 'auth/phone-number-already-exists',
  /** `createUser` on an e-mail another Auth user holds — the race loser. */
  EmailTaken: 'auth/email-already-exists',
  /** `getUserByPhoneNumber` / `getUserByEmail` found nobody. */
  UserNotFound: 'auth/user-not-found',
} as const;

/** The Admin SDK error's own code (`auth/…`), or `null`. */
function authCodeOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' ? error.code : null;
}

/**
 * An Admin-Auth call that failed for a reason this adapter does not answer
 * as a value: `unavailable` when a retry could help (the trigger-attempt
 * vocabulary's transient codes), `unknown` otherwise; the SDK's code rides
 * as `refusal`.
 */
function authFailure(error: unknown): PipelineError {
  const canonical = TriggerAttemptSystem.failureCode(error);
  const code =
    TriggerAttemptSystem.attemptOutcome(canonical) === AttemptOutcome.Transient
      ? PipelineErrorCode.Unavailable
      : PipelineErrorCode.Unknown;
  return PipelineError.of(code, null, authCodeOf(error), null);
}

export const authClaimsPorts = (
  auth: Auth,
): AuthAdminPorts & AuthUserLookupPorts => ({
  mintCustomToken: async (uid, claims) => {
    try {
      return Result.ok(
        await auth.createCustomToken(uid, AuthClaims.toToken(claims)),
      );
    } catch (error) {
      return Result.err(authFailure(error));
    }
  },

  setDisplayName: async (uid, displayName) => {
    try {
      await auth.updateUser(uid, { displayName });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(authFailure(error));
    }
  },

  provisionAuthUser: async (destination) => {
    try {
      const created = await auth.createUser(
        destination.identifierChannel === IdentifierChannel.Email
          ? { email: destination.identifier }
          : { phoneNumber: destination.identifier },
      );
      return Result.ok(UserId.of(created.uid));
    } catch (error) {
      const code = authCodeOf(error);
      return code === AuthRefusal.PhoneTaken || code === AuthRefusal.EmailTaken
        ? Result.ok(null)
        : Result.err(authFailure(error));
    }
  },

  findAuthUserByDestination: async (destination) => {
    try {
      const found =
        destination.identifierChannel === IdentifierChannel.Email
          ? await auth.getUserByEmail(destination.identifier)
          : await auth.getUserByPhoneNumber(destination.identifier);
      return Result.ok(UserId.of(found.uid));
    } catch (error) {
      return authCodeOf(error) === AuthRefusal.UserNotFound
        ? Result.ok(null)
        : Result.err(authFailure(error));
    }
  },
});
