import { Otp, OtpId } from '@creativo/domain/models';
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
  UserRecordSnapshot,
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

/** What the atomic verify exchange decided — set by the decide callback. */
type VerifyExchangeOutcome =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'verified'; readonly otp: Otp };

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

    // Verify inside ONE atomic exchange, not find-then-save. The split
    // version let N parallel wrong guesses all read `attemptCount: 0` and
    // all persist `1` — the lockout `maxAttempts` promises never accrued
    // for exactly the caller it exists to stop. `decide` may run more than
    // once on contention, so the branch taken is re-derived each run and
    // the LAST run's outcome is the one the transaction committed.
    let outcome: VerifyExchangeOutcome | null = null;

    const updateResult = await this.otpRepository.update(
      otpIdResult.value,
      (otp) => {
        if (!otp) {
          outcome = { kind: 'not_found' };
          return null;
        }
        const verifyResult = otp.verify(input.code, this.hasher, now);
        if (verifyResult.isFailure()) {
          outcome = { kind: 'refused', reason: verifyResult.error.kind };
          // The attempt itself is a real state change even though the code
          // was wrong — persist the incremented attemptCount so lockout
          // actually accrues, atomically with the read that justified it.
          return verifyResult.error.kind === 'wrong_code'
            ? otp.recordFailedAttempt()
            : null;
        }
        outcome = { kind: 'verified', otp: verifyResult.value };
        return verifyResult.value;
      },
    );
    if (updateResult.isFailure()) {
      return fail(new RepositoryFailure(updateResult.error));
    }

    // The assertion is load-bearing: `outcome` is assigned only inside the
    // decide closure, which TypeScript's flow analysis cannot see, so the
    // variable — and anything initialized from it — stays narrowed to its
    // initial `null` and every guard below would collapse to `never`.
    const settled = outcome as VerifyExchangeOutcome | null;
    if (settled === null || settled.kind === 'not_found') {
      return fail(new OtpNotFoundError());
    }
    if (settled.kind === 'refused') {
      if (settled.reason === 'wrong_code')
        return fail(new IncorrectCodeError());
      if (settled.reason === 'already_consumed')
        return fail(new OtpAlreadyConsumedError());
      if (settled.reason === 'expired') return fail(new OtpExpiredError());
      return fail(new OtpLockedOutError());
    }

    const verifiedOtp = settled.otp;

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
    // Activation is keyed off `registered` (the accounts-shape profile
    // `completeRegistration` writes — never present at provisioning time):
    // a user found on a *second* login who never finished onboarding
    // (abandoned mid-flow) must still land back in `onboarding`, not be
    // waved through as `active` just because a Firestore record already
    // exists for them.
    const claims = user.registered
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
  ): Promise<Result<UserRecordSnapshot, VerifyOtpError>> {
    const provisionResult = await this.authToken.provisionAuthUser(destination);
    if (provisionResult.isFailure()) {
      return fail(new TokenMintingFailure(provisionResult.error));
    }
    const uid = provisionResult.value;

    // Nothing but the login channel exists yet — the accounts-shape
    // profile (names/roles/status) arrives with `completeRegistration`.
    const stub = {
      id: uid,
      email:
        destination.kind === 'email' ? otpDestinationValue(destination) : null,
      phone:
        destination.kind === 'sms' ? otpDestinationValue(destination) : null,
    };

    const saveUserResult = await this.userRepository.provision(stub);
    if (saveUserResult.isFailure()) {
      return fail(new RepositoryFailure(saveUserResult.error));
    }

    return ok({ ...stub, birthDate: null, registered: false });
  }
}
