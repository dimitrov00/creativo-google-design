import type { Auth } from 'firebase-admin/auth';
import {
  AuthTokenError,
  AuthTokenPort,
  OtpDestination,
  otpDestinationValue,
} from '@creativo/application/identity';
import { Role, TenantId, UserId } from '@creativo/domain/models';
import { Result, fail, ok } from '@creativo/domain/kernel';

export class FirebaseAuthTokenAdapter implements AuthTokenPort {
  constructor(private readonly auth: Auth) {}

  async createCustomToken(
    uid: UserId,
    claims: { tenantId: TenantId; role: Role },
  ): Promise<Result<string, AuthTokenError>> {
    try {
      const token = await this.auth.createCustomToken(uid.value, {
        tenantId: claims.tenantId.value,
        role: claims.role,
      });
      return ok(token);
    } catch (error) {
      return fail(new AuthTokenError('Failed to mint custom token', error));
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
