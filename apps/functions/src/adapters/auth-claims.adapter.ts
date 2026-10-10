import type { Auth } from 'firebase-admin/auth';
import {
  AttemptOutcome,
  AuthClaims,
  type FindAuthUserByDestination,
  IdentifierKind,
  type MintCustomToken,
  PipelineError,
  PipelineErrorCode,
  type ProvisionAuthUser,
  Result,
  type SetClaims,
  type SetDisplayName,
  TriggerAttemptSystem,
  UserId,
} from '@creativo/ecs-core';

/**
 * The Admin-Auth ports of `identity.port.ts` over `firebase-admin/auth`:
 * custom-token minting, custom claims, the Auth user's display name, and
 * the two Auth-user calls of the first-verification race
 * (`provisionAuthUser`, `findAuthUserByDestination`, blueprint §4.1
 * `verifyOtp`). Today's `FirebaseAuthTokenAdapter`
 * (`firebase-auth-token-adapter.ts`) keeps serving the `lib/otp/*` handlers
 * until the identity flip.
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

export type AuthClaimsPorts = {
  readonly mintCustomToken: MintCustomToken;
  readonly setClaims: SetClaims;
  readonly setDisplayName: SetDisplayName;
  readonly provisionAuthUser: ProvisionAuthUser;
  readonly findAuthUserByDestination: FindAuthUserByDestination;
};

export const authClaimsPorts = (auth: Auth): AuthClaimsPorts => ({
  mintCustomToken: async (uid, claims) => {
    try {
      return Result.ok(
        await auth.createCustomToken(uid, AuthClaims.toToken(claims)),
      );
    } catch (error) {
      return Result.err(authFailure(error));
    }
  },

  setClaims: async (uid, claims) => {
    try {
      await auth.setCustomUserClaims(uid, AuthClaims.toToken(claims));
      return Result.ok(undefined);
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
        destination.kind === IdentifierKind.Email
          ? { email: destination.value }
          : { phoneNumber: destination.value },
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
        destination.kind === IdentifierKind.Email
          ? await auth.getUserByEmail(destination.value)
          : await auth.getUserByPhoneNumber(destination.value);
      return Result.ok(UserId.of(found.uid));
    } catch (error) {
      return authCodeOf(error) === AuthRefusal.UserNotFound
        ? Result.ok(null)
        : Result.err(authFailure(error));
    }
  },
});
