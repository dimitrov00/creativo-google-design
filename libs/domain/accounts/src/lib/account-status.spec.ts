import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { AccountStatus } from './account-status';

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'Europe/Sofia');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const NOW = at('2026-07-22T12:00:00');

describe('AccountStatus', () => {
  it('active() is a shared singleton (no reason field)', () => {
    expect(AccountStatus.active()).toEqual({ kind: 'active' });
    expect(AccountStatus.active()).toBe(AccountStatus.active());
  });

  it('blocked() carries the reason and omits until when permanent', () => {
    const status = AccountStatus.blocked({ reason: 'terms_violation' });
    expect(status).toEqual({ kind: 'blocked', reason: 'terms_violation' });
    expect('until' in status).toBe(false);
  });

  it('blocked() with until keeps the expiry', () => {
    const until = at('2026-07-22T13:00:00');
    const status = AccountStatus.blocked({
      reason: 'excessive_failed_attempts',
      until,
    });
    expect(status.kind).toBe('blocked');
    expect(status.until?.toISO()).toBe(until.toISO());
  });

  it('isBlocked() — active is never blocked', () => {
    expect(AccountStatus.isBlocked(AccountStatus.active(), NOW)).toBe(false);
  });

  it('isBlocked() — permanent block is always blocked', () => {
    expect(
      AccountStatus.isBlocked(AccountStatus.blocked({ reason: 'manual' }), NOW),
    ).toBe(true);
  });

  it('isBlocked() — temporary block auto-clears once until has passed', () => {
    const future = AccountStatus.blocked({
      reason: 'fraud_suspect',
      until: at('2026-07-22T12:05:00'),
    });
    const past = AccountStatus.blocked({
      reason: 'fraud_suspect',
      until: at('2026-07-22T11:55:00'),
    });
    expect(AccountStatus.isBlocked(future, NOW)).toBe(true);
    expect(AccountStatus.isBlocked(past, NOW)).toBe(false);
  });
});
