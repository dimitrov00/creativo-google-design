import { Otp, UserId } from '@creativo/domain/models';
import {
  OtpRepositoryPort,
  UserRecordSnapshot,
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
    // The atomic exchange, faked over the same map — read, decide, persist.
    async update(id, decide): Promise<Result<Otp | null, RepositoryError>> {
      const current = store.get(id.value) ?? null;
      const next = decide(current);
      if (next !== null) store.set(next.id.value, next);
      return ok(next ?? current);
    },
  };
}

/** Raw doc mirror of the adapter's `users/{uid}` shape — `registered` derives from `firstName` presence exactly as `FirestoreUserRepository` does. */
interface StoredUserDoc {
  email: string | null;
  phone: string | null;
  firstName?: string;
  birthDate?: string | null;
}

function fakeUserRepository(): UserRepositoryPort & {
  store: Map<string, StoredUserDoc>;
} {
  const store = new Map<string, StoredUserDoc>();
  return {
    store,
    async provision(user): Promise<Result<void, RepositoryError>> {
      store.set(user.id.value, { email: user.email, phone: user.phone });
      return ok(undefined);
    },
    async saveRegistered(user): Promise<Result<void, RepositoryError>> {
      store.set(user.id.value, {
        email: user.email?.value ?? null,
        phone: user.phone.value,
        firstName: user.firstName.value,
        birthDate: user.birthDate?.toISODate() ?? null,
      });
      return ok(undefined);
    },
    async findByDestination(
      destination,
    ): Promise<Result<UserRecordSnapshot | null, RepositoryError>> {
      const raw = otpDestinationValue(destination);
      for (const [id, doc] of store.entries()) {
        if (doc.email === raw || doc.phone === raw) {
          const idResult = UserId.create(id);
          if (idResult.isFailure())
            throw new Error('unexpected failure in test fixture');
          return ok({
            id: idResult.value,
            email: doc.email,
            phone: doc.phone,
            birthDate: doc.birthDate ?? null,
            registered: !!doc.firstName,
          });
        }
      }
      return ok(null);
    },
  };
}

function fakeAuthToken() {
  let uidCounter = 0;
  const mintedTokens: Array<{
    uid: string;
    tenantId: unknown;
    claims: unknown;
  }> = [];
  return {
    mintedTokens,
    async createCustomToken(
      uid: { value: string },
      tenantId: unknown,
      claims: unknown,
    ) {
      mintedTokens.push({ uid: uid.value, tenantId, claims });
      return ok(`token:${uid.value}`);
    },
    async setUserClaims() {
      return ok(undefined);
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
      expect(result.value.sessionKind).toBe('new');
    }
    const minted = authToken.mintedTokens[0];
    expect((minted.tenantId as { value: string }).value).toBe('creativo');
    // A freshly provisioned user has no registered profile yet — claims
    // stay `onboarding` until `completeRegistration` writes one.
    expect(minted.claims).toEqual({ stage: 'onboarding' });
    expect(users.store.size).toBe(1);
    expect(users.store.get('uid_1')).toEqual({
      email: 'client@example.com',
      phone: null,
    });
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

    const second_result = await useCase.execute({
      otpId: 'otp_2',
      code: '654321',
    });

    expect(second_result.isSuccess()).toBe(true);
    if (second_result.isSuccess()) {
      expect(second_result.value.sessionKind).toBe('returning');
    }
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

  it('never mints owner/performer/admin claims through this path, even for an already-registered returning user', async () => {
    const otps = fakeOtpRepository();
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const otp = issueOtp(clock);
    await otps.save(otp);

    // Seed a completed registration (accounts-shape doc — `firstName`
    // present is what flips the adapter's `registered` flag).
    users.store.set('uid_existing', {
      email: 'client@example.com',
      phone: '+14155552671',
      firstName: 'Existing',
    });

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
      expect(result.value.sessionKind).toBe('returning');
    }
    const claims = authToken.mintedTokens[0].claims as {
      stage: string;
      roles: string[];
    };
    expect(claims.stage).toBe('active');
    expect(claims.roles).toEqual(['client']);
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
