import { Otp } from '@creativo/domain/models';
import {
  OtpCode,
  OtpDestination,
  OtpRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import {
  AuthDeployment,
  DEFAULT_AUTH_DEPLOYMENT,
  createAuthStrategy,
} from '@creativo/domain/identity';
import { describe, expect, it } from 'vitest';
import { SystemClock } from '../adapters/system-clock';
import { RequestOtpUseCase } from './request-otp.use-case';
import {
  InvalidInputError,
  OtpChannelMismatchError,
  RateLimitedError,
} from './request-otp.errors';

/** A deployment fixture with an explicit challenge kind/policy — the specs must not silently ride whatever the workspace default happens to be. */
function deployment(
  kind: 'phone_otp' | 'email_otp',
  policy = { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
): AuthDeployment {
  const strategy = createAuthStrategy({
    kind,
    required: ['phone', 'firstName', 'lastName'],
    policy,
  });
  if (strategy.isFailure()) throw new Error('fixture strategy invalid');
  return { ...DEFAULT_AUTH_DEPLOYMENT, strategy: strategy.value };
}

function fakeCrypto() {
  return {
    generateCode: () => '123456',
    generateSalt: () => 'salt',
    hash: (code: string, salt: string) => `hash(${code},${salt})`,
    verify: () => true,
  };
}

/** A tiny in-memory OtpRepositoryPort double — deliberately not the real Firestore adapter, this spec is about the use-case's own orchestration logic. */
function fakeRepository(): OtpRepositoryPort & { saved: Otp[] } {
  const saved: Otp[] = [];
  const recentSince = new Map<string, string>(); // destination -> most recent createdAt ISO

  return {
    saved,
    async save(otp): Promise<Result<void, RepositoryError>> {
      saved.push(otp);
      recentSince.set(otp.destination, otp.createdAt.toISO());
      return ok(undefined);
    },
    async findById(): Promise<Result<Otp | null, RepositoryError>> {
      return ok(null);
    },
    async findRecentUnconsumedByDestination(
      destination,
      since,
    ): Promise<Result<boolean, RepositoryError>> {
      const lastCreated = recentSince.get(otpDestinationValue(destination));
      const isRecent = !!lastCreated && lastCreated >= since.toISO();
      return ok(isRecent);
    },
  };
}

class FixedClock {
  constructor(private iso: string) {}
  now(zone: string) {
    return ZonedDateTime.fromISO(this.iso, zone);
  }
  advance(iso: string) {
    this.iso = iso;
  }
}

class FakeSender {
  sent: Array<{ destination: OtpDestination; code: OtpCode }> = [];
  async send(destination: OtpDestination, code: OtpCode) {
    this.sent.push({ destination, code });
    return ok(undefined);
  }
}

const validInput = {
  tenantId: 'creativo',
  destination: 'client@example.com',
  destinationType: 'email' as const,
  purpose: 'login' as const,
};

describe('RequestOtpUseCase', () => {
  it('creates an OTP, sends the raw code, and returns otpId + rawCode', async () => {
    const repo = fakeRepository();
    const sender = new FakeSender();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const useCase = new RequestOtpUseCase(
      repo,
      sender,
      clock,
      fakeCrypto(),
      deployment('email_otp'),
    );

    const result = await useCase.execute(validInput);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.otpId).toBeTruthy();
      expect(result.value.rawCode).toBe('123456');
    }
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].code).toBe('123456');
    expect(repo.saved).toHaveLength(1);
  });

  it('rejects malformed input', async () => {
    const useCase = new RequestOtpUseCase(
      fakeRepository(),
      new FakeSender(),
      new FixedClock('2026-01-01T00:00:00.000Z'),
      fakeCrypto(),
      deployment('email_otp'),
    );

    const result = await useCase.execute({ tenantId: '' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidInputError);
    }
  });

  it('rate-limits a second request for the same destination within the window', async () => {
    const repo = fakeRepository();
    const sender = new FakeSender();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const useCase = new RequestOtpUseCase(
      repo,
      sender,
      clock,
      fakeCrypto(),
      deployment('email_otp'),
    );

    await useCase.execute(validInput);
    clock.advance('2026-01-01T00:00:30.000Z');
    const result = await useCase.execute(validInput);

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(RateLimitedError);
    }
    expect(sender.sent).toHaveLength(1);
  });

  it('allows a new request once the rate-limit window has passed', async () => {
    const repo = fakeRepository();
    const sender = new FakeSender();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const useCase = new RequestOtpUseCase(
      repo,
      sender,
      clock,
      fakeCrypto(),
      deployment('email_otp'),
    );

    await useCase.execute(validInput);
    clock.advance('2026-01-01T00:02:00.000Z');
    const result = await useCase.execute(validInput);

    expect(result.isSuccess()).toBe(true);
    expect(sender.sent).toHaveLength(2);
  });

  it('rejects an email request under a phone_otp deployment (channel mismatch)', async () => {
    const sender = new FakeSender();
    const useCase = new RequestOtpUseCase(
      fakeRepository(),
      sender,
      new FixedClock('2026-01-01T00:00:00.000Z'),
      fakeCrypto(),
      deployment('phone_otp'),
    );

    const result = await useCase.execute(validInput);

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(OtpChannelMismatchError);
      expect(result.error.code).toBe('otp_channel_mismatch');
      expect(result.error.params).toEqual({
        requested: 'email',
        strategyKind: 'phone_otp',
      });
    }
    expect(sender.sent).toHaveLength(0);
  });

  it('rejects an sms request under an email_otp deployment (channel mismatch)', async () => {
    const sender = new FakeSender();
    const useCase = new RequestOtpUseCase(
      fakeRepository(),
      sender,
      new FixedClock('2026-01-01T00:00:00.000Z'),
      fakeCrypto(),
      deployment('email_otp'),
    );

    const result = await useCase.execute({
      ...validInput,
      destination: '+359888123456',
      destinationType: 'sms' as const,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(OtpChannelMismatchError);
    }
    expect(sender.sent).toHaveLength(0);
  });

  it("issues the OTP with the deployment strategy's own ttl/maxAttempts, not local constants", async () => {
    const repo = fakeRepository();
    const useCase = new RequestOtpUseCase(
      repo,
      new FakeSender(),
      new FixedClock('2026-01-01T00:00:00.000Z'),
      fakeCrypto(),
      deployment('email_otp', {
        ttlMinutes: 7,
        maxAttempts: 2,
        sessionDays: 30,
      }),
    );

    const result = await useCase.execute(validInput);

    expect(result.isSuccess()).toBe(true);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0].maxAttempts).toBe(2);
    const issuedAt = ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC');
    if (issuedAt.isFailure()) throw new Error('fixture instant invalid');
    expect(repo.saved[0].expiresAt.toISO()).toBe(
      issuedAt.value.plusMinutes(7).toISO(),
    );
  });
});

describe('RequestOtpUseCase with the real SystemClock', () => {
  it('generates a valid otpId end-to-end', async () => {
    const useCase = new RequestOtpUseCase(
      fakeRepository(),
      new FakeSender(),
      new SystemClock(),
      fakeCrypto(),
      deployment('email_otp'),
    );
    const result = await useCase.execute(validInput);
    expect(result.isSuccess()).toBe(true);
  });
});
