import { Result } from '@creativo/domain/kernel';
import { OtpDestinationType } from '../otp';
import { UserId } from '../ids';
import { Role } from '../role';

export class AuthTokenError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Wraps the two Firebase Admin Auth operations `apps/functions`'s OTP use-cases need — the concrete adapter (`apps/functions/src/adapters`) is the one place still needing the real SDK. */
export interface AuthTokenPort {
  createCustomToken(
    uid: UserId,
    claims: { tenantId: string; role: Role },
  ): Promise<Result<string, AuthTokenError>>;

  /** First-time signup only: mints a real Firebase Auth user record (so email/phone are properly registered against it) and returns its uid. */
  provisionAuthUser(
    destination: string,
    destinationType: OtpDestinationType,
  ): Promise<Result<UserId, AuthTokenError>>;
}
