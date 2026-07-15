import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { Otp } from './otp';
import { OtpCodeGenerator, OtpCodeHasher } from './ports/otp-crypto.port';

/** Deterministic fakes — the entity's own logic is what's under test here, not a real hashing algorithm (that's `apps/functions`'s adapter concern). */
function fakeCrypto(fixedCode = '123456'): OtpCodeGenerator & OtpCodeHasher {
  return {
    generateCode: () => fixedCode,
    generateSalt: () => 'fixed-salt',
    hash: (code, salt) => `hash(${code},${salt})`,
    verify: (code, salt, expectedHash) =>
      `hash(${code},${salt})` === expectedHash,
  };
}

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function validIssueProps() {
  return {
    id: 'otp_1',
    tenantId: 'creativo',
    destination: 'client@example.com',
    destinationType: 'email' as const,
    purpose: 'login' as const,
    maxAttempts: 5,
    ttlMinutes: 5,
  };
}

describe('Otp.issue', () => {
  it('generates a code via the injected generator and hashes it, never persisting the raw code', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(
      validIssueProps(),
      fakeCrypto('654321'),
      fakeCrypto(),
      now,
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.rawCode).toBe('654321');
      expect(result.value.otp.codeHash).toBe('hash(654321,fixed-salt)');
      expect(result.value.otp.attemptCount).toBe(0);
      expect(result.value.otp.consumedAt).toBeNull();
    }
  });

  it('computes expiresAt as now + ttlMinutes', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(
      validIssueProps(),
      fakeCrypto(),
      fakeCrypto(),
      now,
    );
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.otp.expiresAt.toISO()).toContain('T00:05:00');
  });

  it('rejects an empty destination', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(
      { ...validIssueProps(), destination: '' },
      fakeCrypto(),
      fakeCrypto(),
      now,
    );
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a non-positive maxAttempts', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(
      { ...validIssueProps(), maxAttempts: 0 },
      fakeCrypto(),
      fakeCrypto(),
      now,
    );
    expect(result.isFailure()).toBe(true);
  });
});

describe('Otp.verify', () => {
  function issued(now: ZonedDateTime, code = '123456') {
    const result = Otp.issue(
      validIssueProps(),
      fakeCrypto(code),
      fakeCrypto(),
      now,
    );
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    return result.value.otp;
  }

  it('succeeds with the correct code and marks the OTP consumed', () => {
    const issuedAt = at('2026-01-01T00:00:00.000Z');
    const otp = issued(issuedAt);
    const verifiedAt = at('2026-01-01T00:01:00.000Z');
    const result = otp.verify('123456', fakeCrypto(), verifiedAt);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.consumedAt?.toISO()).toBe(verifiedAt.toISO());
    }
  });

  it('fails with wrong_code for an incorrect code, without mutating attemptCount itself', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const result = otp.verify(
      '000000',
      fakeCrypto(),
      at('2026-01-01T00:01:00.000Z'),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({ kind: 'wrong_code' });
    }
    expect(otp.attemptCount).toBe(0); // verify() itself never mutates
  });

  it('recordFailedAttempt() increments attemptCount on a new instance', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const updated = otp.recordFailedAttempt();
    expect(updated.attemptCount).toBe(1);
    expect(otp.attemptCount).toBe(0); // original untouched
  });

  it('fails with expired once past expiresAt', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const result = otp.verify(
      '123456',
      fakeCrypto(),
      at('2026-01-01T00:10:00.000Z'),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({ kind: 'expired' });
    }
  });

  it('fails with locked_out once attemptCount reaches maxAttempts', () => {
    let otp = issued(at('2026-01-01T00:00:00.000Z'));
    for (let i = 0; i < 5; i++) {
      otp = otp.recordFailedAttempt();
    }
    const result = otp.verify(
      '123456',
      fakeCrypto(),
      at('2026-01-01T00:01:00.000Z'),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({ kind: 'locked_out' });
    }
  });

  it('fails with already_consumed on a second verify', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const first = otp.verify(
      '123456',
      fakeCrypto(),
      at('2026-01-01T00:01:00.000Z'),
    );
    if (first.isFailure())
      throw new Error('unexpected failure in test fixture');
    const second = first.value.verify(
      '123456',
      fakeCrypto(),
      at('2026-01-01T00:02:00.000Z'),
    );
    expect(second.isFailure()).toBe(true);
    if (second.isFailure()) {
      expect(second.error).toEqual({ kind: 'already_consumed' });
    }
  });
});

describe('Otp.reconstitute', () => {
  it('rebuilds an Otp from persisted primitives', () => {
    const result = Otp.reconstitute({
      id: 'otp_1',
      tenantId: 'creativo',
      destination: 'client@example.com',
      destinationType: 'email',
      purpose: 'login',
      codeHash: 'stored-hash',
      salt: 'stored-salt',
      expiresAtIso: '2026-01-01T00:05:00.000Z',
      attemptCount: 2,
      maxAttempts: 5,
      consumedAtIso: null,
      createdAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.attemptCount).toBe(2);
      expect(result.value.consumedAt).toBeNull();
      expect(result.value.codeHash).toBe('stored-hash');
    }
  });

  it('rebuilds a consumed Otp correctly', () => {
    const result = Otp.reconstitute({
      id: 'otp_1',
      tenantId: 'creativo',
      destination: 'client@example.com',
      destinationType: 'email',
      purpose: 'login',
      codeHash: 'stored-hash',
      salt: 'stored-salt',
      expiresAtIso: '2026-01-01T00:05:00.000Z',
      attemptCount: 1,
      maxAttempts: 5,
      consumedAtIso: '2026-01-01T00:01:00.000Z',
      createdAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.consumedAt).not.toBeNull();
    }
  });
});
