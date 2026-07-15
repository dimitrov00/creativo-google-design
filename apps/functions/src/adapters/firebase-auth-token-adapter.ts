import type { Auth } from 'firebase-admin/auth';
import {
  AuthTokenError,
  AuthTokenPort,
  OtpDestinationType,
  Role,
  UserId,
} from '@creativo/domain/models';
import { Result, fail, ok } from '@creativo/domain/kernel';

export class FirebaseAuthTokenAdapter implements AuthTokenPort {
  constructor(private readonly auth: Auth) {}

  async createCustomToken(
    uid: UserId,
    claims: { tenantId: string; role: Role },
  ): Promise<Result<string, AuthTokenError>> {
    try {
      const token = await this.auth.createCustomToken(uid.value, claims);
      return ok(token);
    } catch (error) {
      return fail(new AuthTokenError('Failed to mint custom token', error));
    }
  }

  async provisionAuthUser(
    destination: string,
    destinationType: OtpDestinationType,
  ): Promise<Result<UserId, AuthTokenError>> {
    try {
      const authUser = await this.auth.createUser(
        destinationType === 'email'
          ? { email: destination }
          : { phoneNumber: destination },
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
