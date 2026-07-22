import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { Otp } from './otp';

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function validIssueProps() {
  return {
    id: 'otp_1',
    identifier: { kind: 'email' as const, value: 'client@example.com' },
    codeHash: 'hash(123456,fixed-salt)',
    salt: 'fixed-salt',
    maxAttempts: 5,
    ttlMinutes: 5,
  };
}

describe('Otp.issue', () => {
  it('builds an Otp from the already-hashed code, never touching a raw code itself', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(validIssueProps(), now);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.codeHash).toBe('hash(123456,fixed-salt)');
      expect(result.value.salt).toBe('fixed-salt');
      expect(result.value.identifier.kind).toBe('email');
      expect(result.value.attemptCount).toBe(0);
      expect(result.value.consumedAt).toBeNull();
    }
  });

  it('computes expiresAt as now + ttlMinutes', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(validIssueProps(), now);
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.expiresAt.toISO()).toContain('T00:05:00');
  });

  it('rejects an invalid identifier', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(
      {
        ...validIssueProps(),
        identifier: { kind: 'email', value: 'not-an-email' },
      },
      now,
    );
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty codeHash', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue({ ...validIssueProps(), codeHash: '  ' }, now);
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty salt', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue({ ...validIssueProps(), salt: '' }, now);
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a non-positive maxAttempts', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue({ ...validIssueProps(), maxAttempts: 0 }, now);
    expect(result.isFailure()).toBe(true);
  });

  it('collects every field error at once', () => {
    const now = at('2026-01-01T00:00:00.000Z');
    const result = Otp.issue(
      {
        id: '',
        identifier: { kind: 'email', value: 'not-an-email' },
        codeHash: '',
        salt: '',
        maxAttempts: 0,
        ttlMinutes: 5,
      },
      now,
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBe(5);
    }
  });
});

describe('Otp.verify', () => {
  function issued(now: ZonedDateTime) {
    const result = Otp.issue(validIssueProps(), now);
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    return result.value;
  }

  it('succeeds when codeMatches is true and marks the OTP consumed', () => {
    const issuedAt = at('2026-01-01T00:00:00.000Z');
    const otp = issued(issuedAt);
    const verifiedAt = at('2026-01-01T00:01:00.000Z');
    const result = otp.verify(true, verifiedAt);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.consumedAt?.toISO()).toBe(verifiedAt.toISO());
    }
  });

  it('fails with wrong_code when codeMatches is false, without mutating attemptCount itself', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const result = otp.verify(false, at('2026-01-01T00:01:00.000Z'));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({ kind: 'wrong_code' });
    }
    expect(otp.attemptCount).toBe(0);
  });

  it('recordFailedAttempt() increments attemptCount on a new instance', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const updated = otp.recordFailedAttempt();
    expect(updated.attemptCount).toBe(1);
    expect(otp.attemptCount).toBe(0);
  });

  it('fails with expired once past expiresAt', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const result = otp.verify(true, at('2026-01-01T00:10:00.000Z'));
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
    const result = otp.verify(true, at('2026-01-01T00:01:00.000Z'));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({ kind: 'locked_out' });
    }
  });

  it('fails with already_consumed on a second verify', () => {
    const otp = issued(at('2026-01-01T00:00:00.000Z'));
    const first = otp.verify(true, at('2026-01-01T00:01:00.000Z'));
    if (first.isFailure())
      throw new Error('unexpected failure in test fixture');
    const second = first.value.verify(true, at('2026-01-01T00:02:00.000Z'));
    expect(second.isFailure()).toBe(true);
    if (second.isFailure()) {
      expect(second.error).toEqual({ kind: 'already_consumed' });
    }
  });
});

describe('Otp.reconstitute', () => {
  function validReconstituteProps() {
    return {
      id: 'otp_1',
      identifier: { kind: 'email' as const, value: 'client@example.com' },
      codeHash: 'stored-hash',
      salt: 'stored-salt',
      expiresAtIso: '2026-01-01T00:05:00.000Z',
      attemptCount: 2,
      maxAttempts: 5,
      consumedAtIso: null,
      createdAtIso: '2026-01-01T00:00:00.000Z',
    };
  }

  it('rebuilds an Otp from persisted primitives', () => {
    const result = Otp.reconstitute(validReconstituteProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.attemptCount).toBe(2);
      expect(result.value.consumedAt).toBeNull();
      expect(result.value.codeHash).toBe('stored-hash');
      expect(result.value.identifier.kind).toBe('email');
    }
  });

  it('rebuilds a consumed Otp correctly', () => {
    const result = Otp.reconstitute({
      ...validReconstituteProps(),
      attemptCount: 1,
      consumedAtIso: '2026-01-01T00:01:00.000Z',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.consumedAt).not.toBeNull();
    }
  });

  it('rejects an invalid persisted id', () => {
    const result = Otp.reconstitute({ ...validReconstituteProps(), id: '' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an invalid persisted consumedAtIso', () => {
    const result = Otp.reconstitute({
      ...validReconstituteProps(),
      consumedAtIso: 'not-a-date',
    });
    expect(result.isFailure()).toBe(true);
  });
});
