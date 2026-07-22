import { Otp, User, UserId } from '@creativo/domain/models';
import {
  OtpRepositoryPort,
  UserRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { SystemClock } from '../adapters/system-clock';
import {
  IncorrectCodeError,
  OtpAlreadyConsumedError,
  OtpExpiredError,
  OtpLockedOutError,
  OtpNotFoundError,
} from './verify-otp.errors';
import { VerifyOtpUseCase } from './verify-otp.use-case';

/**
 * Self-consistent fake: `hash`/`verify` actually depend on the code+salt
 * (unlike a hardcoded "one valid code" stub), so it correctly verifies
 * whichever code+salt a given OTP was actually issued with — needed once a
 * test issues more than one OTP with different codes.
 */
function fakeCrypto(code = '123456') {
  return {
    generateCode: () => code,
    generateSalt: () => 'salt',
    hash: (c: string, s: string) => `hash(${c},${s})`,
    verify: (c: string, s: string, expectedHash: string) =>
      `hash(${c},${s})` === expectedHash,
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

function fakeOtpRepository(): OtpRepositoryPort & { store: Map<string, Otp> } {
  const store = new Map<string, Otp>();
  return {
    store,
    async save(otp): Promise<Result<void, RepositoryError>> {
      store.set(otp.id.value, otp);
      return ok(undefined);
    },
    async findById(id): Promise<Result<Otp | null, RepositoryError>> {
      return ok(store.get(id.value) ?? null);
    },
    async findRecentUnconsumedByDestination(): Promise<
      Result<boolean, RepositoryError>
    > {
      return ok(false);
    },
  };
}

function fakeUserRepository(): UserRepositoryPort & {
  store: Map<string, User>;
} {
  const store = new Map<string, User>();
  return {
    store,
    async save(user): Promise<Result<void, RepositoryError>> {
      store.set(user.id.value, user);
      return ok(undefined);
    },
    async findByDestination(
      destination,
    ): Promise<Result<User | null, RepositoryError>> {
      const raw = otpDestinationValue(destination);
      for (const user of store.values()) {
        if (user.email?.value === raw || user.phone === raw) return ok(user);
      }
      return ok(null);
    },
  };
}

function fakeAuthToken() {
  let uidCounter = 0;
  const mintedTokens: Array<{ uid: string; claims: unknown }> = [];
  return {
    mintedTokens,
    async createCustomToken(uid: { value: string }, claims: unknown) {
      mintedTokens.push({ uid: uid.value, claims });
      return ok(`token:${uid.value}`);
    },
    async provisionAuthUser() {
      uidCounter++;
      const idResult = UserId.create(`uid_${uidCounter}`);
      if (idResult.isFailure())
        throw new Error('unexpected failure in test fixture');
      return ok(idResult.value);
    },
  };
}

function issueOtp(clock: FixedClock, code = '123456'): Otp {
  const nowResult = clock.now('UTC');
  if (nowResult.isFailure())
    throw new Error('unexpected failure in test fixture');
  const result = Otp.issue(
    {
      id: 'otp_1',
      tenantId: 'creativo',
      destination: 'client@example.com',
      destinationType: 'email',
      purpose: 'login',
      maxAttempts: 5,
      ttlMinutes: 5,
    },
    fakeCrypto(code),
    fakeCrypto(code),
    nowResult.value,
  );
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value.otp;
}

describe('VerifyOtpUseCase', () => {
  it('mints a client-role custom token on a correct code, provisioning a new user', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    const result = await useCase.execute({ otpId: 'otp_1', code: '123456' });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.customToken).toContain('token:');
    }
    const claims = authToken.mintedTokens[0].claims as {
      tenantId: { value: string };
      role: string;
    };
    expect(claims.tenantId.value).toBe('creativo');
    expect(claims.role).toBe('client');
    expect(users.store.size).toBe(1);
  });

  it('reuses an existing user on a second OTP flow for the same destination', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');

    const first = issueOtp(clock);
    await otps.save(first);
    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    await useCase.execute({ otpId: 'otp_1', code: '123456' });

    clock.advance('2026-01-01T00:02:00.000Z');
    const second = Otp.issue(
      {
        id: 'otp_2',
        tenantId: 'creativo',
        destination: 'client@example.com',
        destinationType: 'email',
        purpose: 'login',
        maxAttempts: 5,
        ttlMinutes: 5,
      },
      fakeCrypto('654321'),
      fakeCrypto('654321'),
      (() => {
        const now = clock.now('UTC');
        if (now.isFailure())
          throw new Error('unexpected failure in test fixture');
        return now.value;
      })(),
    );
    if (second.isFailure())
      throw new Error('unexpected failure in test fixture');
    await otps.save(second.value.otp);

    await useCase.execute({ otpId: 'otp_2', code: '654321' });

    expect(users.store.size).toBe(1); // still just one user
    expect(authToken.mintedTokens).toHaveLength(2);
    expect(authToken.mintedTokens[0].uid).toBe(authToken.mintedTokens[1].uid);
  });

  it('rejects an incorrect code and increments attemptCount on the stored OTP', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    const result = await useCase.execute({ otpId: 'otp_1', code: '000000' });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(IncorrectCodeError);
    }
    expect(otps.store.get('otp_1')?.attemptCount).toBe(1);
    expect(authToken.mintedTokens).toHaveLength(0);
  });

  it('locks out after maxAttempts incorrect tries, even with the correct code', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    for (let i = 0; i < 5; i++) {
      await useCase.execute({ otpId: 'otp_1', code: '000000' });
    }

    const result = await useCase.execute({ otpId: 'otp_1', code: '123456' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(OtpLockedOutError);
    }
  });

  it('rejects an expired OTP', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);
    clock.advance('2026-01-01T00:10:00.000Z');

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    const result = await useCase.execute({ otpId: 'otp_1', code: '123456' });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(OtpExpiredError);
    }
  });

  it('rejects reusing an already-consumed OTP', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    await useCase.execute({ otpId: 'otp_1', code: '123456' });
    const second = await useCase.execute({ otpId: 'otp_1', code: '123456' });

    expect(second.isFailure()).toBe(true);
    if (second.isFailure()) {
      expect(second.error).toBeInstanceOf(OtpAlreadyConsumedError);
    }
  });

  it('rejects an unknown otpId', async () => {
    const useCase = new VerifyOtpUseCase(
      fakeOtpRepository(),
      fakeUserRepository(),
      fakeAuthToken(),
      new FixedClock('2026-01-01T00:00:00.000Z'),
      fakeCrypto(),
    );
    const result = await useCase.execute({ otpId: 'nope', code: '123456' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(OtpNotFoundError);
    }
  });

  it('never mints owner/performer/admin claims through this path', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    await useCase.execute({ otpId: 'otp_1', code: '123456' });

    const claims = authToken.mintedTokens[0].claims as { role: string };
    expect(claims.role).toBe('client');
  });
});

describe('VerifyOtpUseCase with the real SystemClock', () => {
  it('verifies successfully end-to-end', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new SystemClock();
    const nowResult = clock.now('UTC');
    if (nowResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    const issueResult = Otp.issue(
      {
        id: 'otp_1',
        tenantId: 'creativo',
        destination: 'client@example.com',
        destinationType: 'email',
        purpose: 'login',
        maxAttempts: 5,
        ttlMinutes: 5,
      },
      fakeCrypto(),
      fakeCrypto(),
      nowResult.value,
    );
    if (issueResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    await otps.save(issueResult.value.otp);

    const useCase = new VerifyOtpUseCase(
      otps,
      users,
      authToken,
      clock,
      fakeCrypto(),
    );
    const result = await useCase.execute({ otpId: 'otp_1', code: '123456' });
    expect(result.isSuccess()).toBe(true);
  });
});
