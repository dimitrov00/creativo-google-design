import type { Auth } from 'firebase-admin/auth';
import {
  AuthTokenError,
  AuthTokenPort,
  OtpDestination,
  otpDestinationValue,
} from '@creativo/application/identity';
import { TenantId, UserId } from '@creativo/domain/models';
import { AuthClaims } from '@creativo/domain/identity';
import { Result, fail, ok } from '@creativo/domain/kernel';

function toRawClaims(
  tenantId: TenantId,
  claims: AuthClaims,
): Record<string, unknown> {
  return claims.stage === 'active'
    ? { tenantId: tenantId.value, stage: 'active', roles: claims.roles }
    : { tenantId: tenantId.value, stage: 'onboarding' };
}

export class FirebaseAuthTokenAdapter implements AuthTokenPort {
  constructor(private readonly auth: Auth) {}

  async createCustomToken(
    uid: UserId,
    tenantId: TenantId,
    claims: AuthClaims,
  ): Promise<Result<string, AuthTokenError>> {
    try {
      const token = await this.auth.createCustomToken(
        uid.value,
        toRawClaims(tenantId, claims),
      );
      return ok(token);
    } catch (error) {
      return fail(new AuthTokenError('Failed to mint custom token', error));
    }
  }

  async setUserClaims(
    uid: UserId,
    tenantId: TenantId,
    claims: AuthClaims,
  ): Promise<Result<void, AuthTokenError>> {
    try {
      await this.auth.setCustomUserClaims(
        uid.value,
        toRawClaims(tenantId, claims),
      );
      return ok(undefined);
    } catch (error) {
      return fail(new AuthTokenError('Failed to set custom claims', error));
    }
  }

  async provisionAuthUser(
    destination: OtpDestination,
  ): Promise<Result<UserId, AuthTokenError>> {
    try {
      const authUser = await this.auth.createUser(
        destination.kind === 'email'
          ? { email: otpDestinationValue(destination) }
          : { phoneNumber: otpDestinationValue(destination) },
      );
      const idResult = UserId.create(authUser.uid);
      if (idResult.isFailure()) {
        return fail(new AuthTokenError('Firebase Auth returned an empty uid'));
      }
      return ok(idResult.value);
    } catch (error) {
      return fail(
        new AuthTokenError('Failed to provision Firebase Auth user', error),
      );
    }
  }
}
