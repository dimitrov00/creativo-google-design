import {
  ClockPort,
  Otp,
  OtpCodeGenerator,
  OtpCodeHasher,
  OtpDestinationType,
  OtpId,
  OtpPurpose,
  OtpRepositoryPort,
  OtpSenderPort,
} from '@creativo/domain/models';
import { Result, fail, ok } from '@creativo/domain/kernel';
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
  destinationType: OtpDestinationType;
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

export class RequestOtpUseCase {
  constructor(
    private readonly otpRepository: OtpRepositoryPort,
    private readonly sender: OtpSenderPort,
    private readonly clock: ClockPort,
    private readonly otpCrypto: OtpCodeGenerator & OtpCodeHasher,
  ) {}

  async execute(
    rawInput: unknown,
  ): Promise<Result<{ otpId: string }, RequestOtpError>> {
    const inputResult = parseInput(rawInput);
    if (inputResult.isFailure()) {
      return fail(inputResult.error);
    }
    const input = inputResult.value;

    const nowResult = this.clock.now(OTP_ZONE);
    if (nowResult.isFailure()) {
      return fail(nowResult.error);
    }
    const now = nowResult.value;

    const sinceIso = now.plusMinutes(-RATE_LIMIT_WINDOW_MINUTES).toISO();
    const recentResult =
      await this.otpRepository.findRecentUnconsumedByDestination(
        input.destination,
        sinceIso,
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
      otp.destination,
      otp.destinationType,
      rawCode,
    );
    if (sendResult.isFailure()) {
      return fail(new SendFailure(sendResult.error));
    }

    return ok({ otpId: otp.id.value });
  }
}
