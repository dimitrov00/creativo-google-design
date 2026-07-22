import { Result } from '@creativo/domain/kernel';
import { TenantId, UserId } from '@creativo/domain/models';
import { AuthClaims } from '@creativo/domain/identity';
import { OtpDestination } from './otp-destination';

export class AuthTokenError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Wraps the three Firebase Admin Auth operations `apps/functions`'s OTP
 * use-cases need — the concrete adapter (`apps/functions/src/adapters`) is
 * the one place still needing the real SDK.
 *
 * Custom-claims payloads carry `AuthClaims` verbatim (`{stage:'onboarding'}`
 * or `{stage:'active', roles}`) alongside `tenantId` — the web app's
 * `parseAuthClaims` (`@creativo/domain/identity`) reads exactly that shape
 * off the ID token, so the two sides of the claims contract stay in one
 * place instead of drifting.
 */
export interface AuthTokenPort {
  /** Mints a token for a brand-new session — always right after `verifyChallenge` succeeds. */
  createCustomToken(
    uid: UserId,
    tenantId: TenantId,
    claims: AuthClaims,
  ): Promise<Result<string, AuthTokenError>>;

  /**
   * Promotes an already-signed-in user's *next* token refresh (does not
   * mint a new token itself) — `completeRegistration`'s activation step.
   * `EnsureSessionReadyUseCase`'s client-side backoff is what observes the
   * flip.
   */
  setUserClaims(
    uid: UserId,
    tenantId: TenantId,
    claims: AuthClaims,
  ): Promise<Result<void, AuthTokenError>>;

  /** First-time signup only: mints a real Firebase Auth user record (so email/phone are properly registered against it) and returns its uid. */
  provisionAuthUser(
    destination: OtpDestination,
  ): Promise<Result<UserId, AuthTokenError>>;
}
