import { randomBytes } from 'node:crypto';
import { OtpId, User } from '@creativo/domain/models';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  ONBOARDING_CLAIMS,
  activeClaims,
  roleFromPrimitive,
} from '@creativo/domain/identity';
import {
  AuthTokenError,
  AuthTokenPort,
  OtpCodeHasher,
  OtpDestination,
  OtpRepositoryPort,
  UserRepositoryPort,
  otpDestinationFromRaw,
  otpDestinationValue,
} from '@creativo/application/identity';
import { ClockPort } from '@creativo/application/shared';
import {
  CorruptedOtpDestinationError,
  IncorrectCodeError,
  InvalidInputError,
  OtpAlreadyConsumedError,
  OtpExpiredError,
  OtpLockedOutError,
  OtpNotFoundError,
  RepositoryFailure,
  TokenMintingFailure,
  UserValidationFailure,
  VerifyOtpError,
} from './verify-otp.errors';

const OTP_ZONE = 'UTC';

export interface VerifyOtpInput {
  otpId: string;
  code: string;
}

function parseInput(raw: unknown): Result<VerifyOtpInput, InvalidInputError> {
  if (typeof raw !== 'object' || raw === null) {
    return fail(new InvalidInputError('payload must be an object'));
  }
  const { otpId, code } = raw as Record<string, unknown>;

  if (typeof otpId !== 'string' || otpId.trim().length === 0) {
    return fail(new InvalidInputError('missing or empty otpId'));
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return fail(new InvalidInputError('code must be a 6-digit string'));
  }

  return ok({ otpId, code });
}

function generateReferralCode(): string {
  return randomBytes(6).toString('base64url').toUpperCase().slice(0, 8);
}

export class VerifyOtpUseCase {
  constructor(
    private readonly otpRepository: OtpRepositoryPort,
    private readonly userRepository: UserRepositoryPort,
    private readonly authToken: AuthTokenPort,
    private readonly clock: ClockPort,
    private readonly hasher: OtpCodeHasher,
  ) {}

  async execute(
    rawInput: unknown,
  ): Promise<
    Result<
      { customToken: string; sessionKind: 'new' | 'returning' },
      VerifyOtpError
    >
  > {
    const inputResult = parseInput(rawInput);
    if (inputResult.isFailure()) {
      return fail(inputResult.error);
    }
    const input = inputResult.value;

    const otpIdResult = OtpId.create(input.otpId);
    if (otpIdResult.isFailure()) {
      return fail(new InvalidInputError('invalid otpId'));
    }

    const nowResult = this.clock.now(OTP_ZONE);
    if (nowResult.isFailure()) {
      return fail(nowResult.error);
    }
    const now = nowResult.value;

    const foundResult = await this.otpRepository.findById(otpIdResult.value);
    if (foundResult.isFailure()) {
      return fail(new RepositoryFailure(foundResult.error));
    }
    const otp = foundResult.value;
    if (!otp) {
      return fail(new OtpNotFoundError());
    }

    const verifyResult = otp.verify(input.code, this.hasher, now);
    if (verifyResult.isFailure()) {
      if (verifyResult.error.kind === 'wrong_code') {
        // The attempt itself is a real state change even though the code
        // was wrong — persist the incremented attemptCount so lockout
        // actually accrues across separate requests.
        await this.otpRepository.save(otp.recordFailedAttempt());
        return fail(new IncorrectCodeError());
      }
      if (verifyResult.error.kind === 'already_consumed')
        return fail(new OtpAlreadyConsumedError());
      if (verifyResult.error.kind === 'expired')
        return fail(new OtpExpiredError());
      return fail(new OtpLockedOutError());
    }

    const verifiedOtp = verifyResult.value;
    const saveResult = await this.otpRepository.save(verifiedOtp);
    if (saveResult.isFailure()) {
      return fail(new RepositoryFailure(saveResult.error));
    }

    const destinationResult = otpDestinationFromRaw(
      verifiedOtp.destination,
      verifiedOtp.destinationType,
    );
    if (destinationResult.isFailure()) {
      return fail(new CorruptedOtpDestinationError(destinationResult.error));
    }
    const destination = destinationResult.value;

    const userResult = await this.userRepository.findByDestination(destination);
    if (userResult.isFailure()) {
      return fail(new RepositoryFailure(userResult.error));
    }

    let user = userResult.value;
    let sessionKind: 'new' | 'returning' = 'returning';
    if (!user) {
      const provisioned = await this.provisionNewUser(destination);
      if (provisioned.isFailure()) {
        return fail(provisioned.error);
      }
      user = provisioned.value;
      sessionKind = 'new';
    }

    // Self-service verifyOtp can only ever mint 'client' claims — there is
    // no path here to 'owner'/'performer'/'admin'. Staff roles are granted
    // out-of-band via the Admin SDK, closing the obvious privilege-
    // escalation hole a self-service role parameter would open.
    //
    // Activation is keyed off `displayName` (set by `completeRegistration`,
    // never at provisioning time): a user found on a *second* login who
    // never finished onboarding (abandoned mid-flow) must still land back
    // in `onboarding`, not be waved through as `active` just because a
    // Firestore record already exists for them.
    const claims = user.displayName
      ? activeClaims([roleFromPrimitive('client')])
      : ok(ONBOARDING_CLAIMS);
    if (claims.isFailure()) {
      // Unreachable — the literal roles array above is never empty.
      return fail(new TokenMintingFailure(new AuthTokenError('empty roles')));
    }

    const tokenResult = await this.authToken.createCustomToken(
      user.id,
      verifiedOtp.tenantId,
      claims.value,
    );
    if (tokenResult.isFailure()) {
      return fail(new TokenMintingFailure(tokenResult.error));
    }

    return ok({ customToken: tokenResult.value, sessionKind });
  }

  private async provisionNewUser(
    destination: OtpDestination,
  ): Promise<Result<User, VerifyOtpError>> {
    const provisionResult = await this.authToken.provisionAuthUser(destination);
    if (provisionResult.isFailure()) {
      return fail(new TokenMintingFailure(provisionResult.error));
    }
    const uid = provisionResult.value;

    const newUserResult = User.create({
      id: uid.value,
      referralCode: generateReferralCode(),
      gamificationPoints: 0,
      tenantMemberships: [],
      email:
        destination.kind === 'email'
          ? otpDestinationValue(destination)
          : undefined,
      phone:
        destination.kind === 'sms'
          ? otpDestinationValue(destination)
          : undefined,
    });
    if (newUserResult.isFailure()) {
      return fail(new UserValidationFailure(newUserResult.error));
    }
    const user = newUserResult.value;

    const saveUserResult = await this.userRepository.save(user);
    if (saveUserResult.isFailure()) {
      return fail(new RepositoryFailure(saveUserResult.error));
    }

    return ok(user);
  }
}
