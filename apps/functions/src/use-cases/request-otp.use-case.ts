import { Email, Otp, OtpId, OtpPurpose } from '@creativo/domain/models';
import { PhoneNumber, Result, fail, ok } from '@creativo/domain/kernel';
import {
  OtpCodeGenerator,
  OtpCodeHasher,
  OtpDestination,
  OtpRepositoryPort,
  OtpSenderPort,
  toRawOtpCode,
} from '@creativo/application/identity';
import { ClockPort } from '@creativo/application/shared';
import {
  InvalidInputError,
  RateLimitedError,
  RepositoryFailure,
  RequestOtpError,
  SendFailure,
  ValidationFailure,
} from './request-otp.errors';

const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MINUTES = 1;
const OTP_ZONE = 'UTC';

export interface RequestOtpInput {
  tenantId: string;
  destination: string;
  destinationType: 'email' | 'sms';
  purpose: OtpPurpose;
}

function parseInput(raw: unknown): Result<RequestOtpInput, InvalidInputError> {
  if (typeof raw !== 'object' || raw === null) {
    return fail(new InvalidInputError('payload must be an object'));
  }
  const { tenantId, destination, destinationType, purpose } = raw as Record<
    string,
    unknown
  >;

  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    return fail(new InvalidInputError('missing or empty tenantId'));
  }
  if (typeof destination !== 'string' || destination.trim().length === 0) {
    return fail(new InvalidInputError('missing or empty destination'));
  }
  if (destinationType !== 'email' && destinationType !== 'sms') {
    return fail(
      new InvalidInputError('destinationType must be "email" or "sms"'),
    );
  }
  if (purpose !== 'login' && purpose !== 'signup') {
    return fail(new InvalidInputError('purpose must be "login" or "signup"'));
  }

  return ok({ tenantId, destination, destinationType, purpose });
}

function parseDestination(
  input: RequestOtpInput,
): Result<OtpDestination, InvalidInputError> {
  if (input.destinationType === 'email') {
    const emailResult = Email.create(input.destination);
    if (emailResult.isFailure()) {
      return fail(new InvalidInputError('invalid email destination'));
    }
    return ok({ kind: 'email', email: emailResult.value });
  }
  const phoneResult = PhoneNumber.create(input.destination);
  if (phoneResult.isFailure()) {
    return fail(new InvalidInputError('invalid phone destination'));
  }
  return ok({ kind: 'sms', phone: phoneResult.value });
}

export class RequestOtpUseCase {
  constructor(
    private readonly otpRepository: OtpRepositoryPort,
    private readonly sender: OtpSenderPort,
    private readonly clock: ClockPort,
    private readonly otpCrypto: OtpCodeGenerator & OtpCodeHasher,
  ) {}

  async execute(
    rawInput: unknown,
  ): Promise<Result<{ otpId: string; rawCode: string }, RequestOtpError>> {
    const inputResult = parseInput(rawInput);
    if (inputResult.isFailure()) {
      return fail(inputResult.error);
    }
    const input = inputResult.value;

    const destinationResult = parseDestination(input);
    if (destinationResult.isFailure()) {
      return fail(destinationResult.error);
    }
    const destination = destinationResult.value;

    const nowResult = this.clock.now(OTP_ZONE);
    if (nowResult.isFailure()) {
      return fail(nowResult.error);
    }
    const now = nowResult.value;

    const since = now.plusMinutes(-RATE_LIMIT_WINDOW_MINUTES);
    const recentResult =
      await this.otpRepository.findRecentUnconsumedByDestination(
        destination,
        since,
      );
    if (recentResult.isFailure()) {
      return fail(new RepositoryFailure(recentResult.error));
    }
    if (recentResult.value) {
      return fail(new RateLimitedError());
    }

    const issueResult = Otp.issue(
      {
        id: OtpId.generate().value,
        tenantId: input.tenantId,
        destination: input.destination,
        destinationType: input.destinationType,
        purpose: input.purpose,
        maxAttempts: MAX_ATTEMPTS,
        ttlMinutes: OTP_TTL_MINUTES,
      },
      this.otpCrypto,
      this.otpCrypto,
      now,
    );
    if (issueResult.isFailure()) {
      return fail(new ValidationFailure(issueResult.error));
    }
    const { otp, rawCode } = issueResult.value;

    const saveResult = await this.otpRepository.save(otp);
    if (saveResult.isFailure()) {
      return fail(new RepositoryFailure(saveResult.error));
    }

    const sendResult = await this.sender.send(
      destination,
      toRawOtpCode(rawCode),
    );
    if (sendResult.isFailure()) {
      return fail(new SendFailure(sendResult.error));
    }

    // `rawCode` is returned to the caller (never persisted) purely so the
    // callable wrapper can echo it back to the client in emulator mode
    // only (E2E has no real SMS/email inbox to read) — production callers
    // must never forward it past this boundary.
    return ok({ otpId: otp.id.value, rawCode });
  }
}
