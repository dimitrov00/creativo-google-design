import {
  Otp,
  OtpRepositoryPort,
  RepositoryError,
} from '@creativo/domain/models';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { SystemClock } from '../adapters/system-clock';
import { RequestOtpUseCase } from './request-otp.use-case';
import { InvalidInputError, RateLimitedError } from './request-otp.errors';

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
      sinceIso,
    ): Promise<Result<boolean, RepositoryError>> {
      const lastCreated = recentSince.get(destination);
      const isRecent = !!lastCreated && lastCreated >= sinceIso;
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
  sent: Array<{ destination: string; channel: string; code: string }> = [];
  async send(destination: string, channel: 'email' | 'sms', code: string) {
    this.sent.push({ destination, channel, code });
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
  it('creates an OTP, sends the raw code, and returns only otpId', async () => {
    const repo = fakeRepository();
    const sender = new FakeSender();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const useCase = new RequestOtpUseCase(repo, sender, clock, fakeCrypto());

    const result = await useCase.execute(validInput);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.otpId).toBeTruthy();
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
    const useCase = new RequestOtpUseCase(repo, sender, clock, fakeCrypto());

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
    const useCase = new RequestOtpUseCase(repo, sender, clock, fakeCrypto());

    await useCase.execute(validInput);
    clock.advance('2026-01-01T00:02:00.000Z');
    const result = await useCase.execute(validInput);

    expect(result.isSuccess()).toBe(true);
    expect(sender.sent).toHaveLength(2);
  });
});

describe('RequestOtpUseCase with the real SystemClock', () => {
  it('generates a valid otpId end-to-end', async () => {
    const useCase = new RequestOtpUseCase(
      fakeRepository(),
      new FakeSender(),
      new SystemClock(),
      fakeCrypto(),
    );
    const result = await useCase.execute(validInput);
    expect(result.isSuccess()).toBe(true);
  });
});
