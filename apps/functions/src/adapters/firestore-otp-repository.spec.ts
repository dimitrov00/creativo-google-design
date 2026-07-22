import type { Firestore } from 'firebase-admin/firestore';
import { Email, Otp, OtpId } from '@creativo/domain/models';
import { OtpDestination } from '@creativo/application/identity';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { createFakeFirestore } from '../test-support/fake-firestore';
import { FirestoreOtpRepository } from './firestore-otp-repository';

function db() {
  return createFakeFirestore() as unknown as Firestore;
}

function fakeCrypto(code = '123456') {
  return {
    generateCode: () => code,
    generateSalt: () => 'salt',
    hash: (c: string, s: string) => `hash(${c},${s})`,
    verify: () => true,
  };
}

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function emailDestination(raw: string): OtpDestination {
  const result = Email.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return { kind: 'email', email: result.value };
}

function issueOtp(nowIso: string): Otp {
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
    fakeCrypto(),
    fakeCrypto(),
    at(nowIso),
  );
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value.otp;
}

describe('FirestoreOtpRepository', () => {
  it('saves and reads back an OTP', async () => {
    const repo = new FirestoreOtpRepository(db());
    const otp = issueOtp('2026-01-01T00:00:00.000Z');

    const saveResult = await repo.save(otp);
    expect(saveResult.isSuccess()).toBe(true);

    const foundResult = await repo.findById(otp.id);
    expect(foundResult.isSuccess()).toBe(true);
    if (foundResult.isSuccess()) {
      expect(foundResult.value?.destination).toBe('client@example.com');
      expect(foundResult.value?.id.equals(otp.id)).toBe(true);
    }
  });

  it('returns null for a missing OTP', async () => {
    const repo = new FirestoreOtpRepository(db());
    const missingId = OtpId.create('nonexistent');
    if (missingId.isFailure())
      throw new Error('unexpected failure in test fixture');

    const result = await repo.findById(missingId.value);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('finds a recent unconsumed OTP for rate limiting', async () => {
    const repo = new FirestoreOtpRepository(db());
    const otp = issueOtp('2026-01-01T00:00:30.000Z');
    await repo.save(otp);

    const hasRecent = await repo.findRecentUnconsumedByDestination(
      emailDestination('client@example.com'),
      at('2026-01-01T00:00:00.000Z'),
    );
    expect(hasRecent.isSuccess()).toBe(true);
    if (hasRecent.isSuccess()) {
      expect(hasRecent.value).toBe(true);
    }
  });

  it('does not count a consumed OTP toward the rate limit', async () => {
    const repo = new FirestoreOtpRepository(db());
    const otp = issueOtp('2026-01-01T00:00:30.000Z');
    const verified = otp.verify(
      '123456',
      fakeCrypto(),
      at('2026-01-01T00:00:31.000Z'),
    );
    if (verified.isFailure())
      throw new Error('unexpected failure in test fixture');
    await repo.save(verified.value);

    const hasRecent = await repo.findRecentUnconsumedByDestination(
      emailDestination('client@example.com'),
      at('2026-01-01T00:00:00.000Z'),
    );
    expect(hasRecent.isSuccess()).toBe(true);
    if (hasRecent.isSuccess()) {
      expect(hasRecent.value).toBe(false);
    }
  });

  it('does not count an OTP older than the rate-limit window', async () => {
    const repo = new FirestoreOtpRepository(db());
    const otp = issueOtp('2025-01-01T00:00:00.000Z');
    await repo.save(otp);

    const hasRecent = await repo.findRecentUnconsumedByDestination(
      emailDestination('client@example.com'),
      at('2026-01-01T00:00:00.000Z'),
    );
    expect(hasRecent.isSuccess()).toBe(true);
    if (hasRecent.isSuccess()) {
      expect(hasRecent.value).toBe(false);
    }
  });
});
