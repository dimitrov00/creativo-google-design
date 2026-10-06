import { AccountStatus } from '@creativo/domain/accounts';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import {
  accountStatusFromDocument,
  accountStatusToDocument,
} from './account-status-document';

function sofia(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'Europe/Sofia');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('account status document — one shape for both SDKs', () => {
  it('writes an active status as its kind alone', () => {
    expect(accountStatusToDocument(AccountStatus.active())).toEqual({
      kind: 'active',
    });
  });

  it('writes a permanent block with a null expiry', () => {
    expect(
      accountStatusToDocument(AccountStatus.blocked({ reason: 'manual' })),
    ).toEqual({ kind: 'blocked', reason: 'manual', untilIso: null });
  });

  it('round-trips a temporary block, expiry included', () => {
    const status = AccountStatus.blocked({
      reason: 'terms_violation',
      until: sofia('2026-12-01T00:00:00'),
    });
    const document = accountStatusToDocument(status);
    const read = accountStatusFromDocument(document);

    expect(read.isSuccess()).toBe(true);
    if (read.isSuccess()) {
      expect(accountStatusToDocument(read.value)).toEqual(document);
      expect(
        AccountStatus.isBlocked(read.value, sofia('2026-11-30T12:00:00')),
      ).toBe(true);
      expect(
        AccountStatus.isBlocked(read.value, sofia('2026-12-01T00:00:01')),
      ).toBe(false);
    }
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['an unknown kind', { kind: 'frozen' }],
    ['a block without a reason', { kind: 'blocked' }],
    ['a block with an unknown reason', { kind: 'blocked', reason: 'rude' }],
    ['a block with a non-string reason', { kind: 'blocked', reason: 7 }],
    [
      'a block with an unreadable expiry',
      { kind: 'blocked', reason: 'manual', untilIso: 'next tuesday' },
    ],
  ])('reads %s as a failure, never as active', (_label, raw) => {
    expect(accountStatusFromDocument(raw).isFailure()).toBe(true);
  });
});
