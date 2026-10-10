import { describe, expect, it } from 'vitest';
import { AccountsErrorCode } from './accounts-errors.data';
import {
  AccountState,
  AccountStatus,
  BLOCK_REASONS,
  BlockReason,
} from './account-status.data';

/*
 * The cases of libs/domain/accounts/src/lib/account-status.spec.ts and
 * block-reason.spec.ts, copied (not moved — the class path keeps its own
 * specs until Phase 4) and run against the plain union: instants are epoch
 * ms, and a permanent block carries `untilMs: null` instead of omitting it.
 */

/** 2026-07-22T12:00:00 Europe/Sofia (UTC+3) as a literal instant. */
const NOW = Date.UTC(2026, 6, 22, 9, 0, 0);
const minutes = (n: number) => n * 60_000;

describe('AccountStatus', () => {
  it('active() is a shared singleton (no reason field)', () => {
    expect(AccountStatus.active()).toEqual({ kind: 'active' });
    expect(AccountStatus.active()).toBe(AccountStatus.active());
    expect(AccountStatus.unblock()).toBe(AccountStatus.active());
  });

  it('block() carries the reason and a null until when permanent', () => {
    const status = AccountStatus.block(BlockReason.TermsViolation, null);
    expect(status).toEqual({
      kind: 'blocked',
      reason: 'terms_violation',
      untilMs: null,
    });
  });

  it('block() with an until keeps the expiry', () => {
    const untilMs = NOW + minutes(60);
    const status = AccountStatus.block(
      BlockReason.ExcessiveFailedAttempts,
      untilMs,
    );
    expect(status.kind).toBe(AccountState.Blocked);
    expect(status.untilMs).toBe(untilMs);
  });

  it('isBlockedAt() — active is never blocked', () => {
    expect(AccountStatus.isBlockedAt(AccountStatus.active(), NOW)).toBe(false);
  });

  it('isBlockedAt() — a permanent block is always blocked', () => {
    expect(
      AccountStatus.isBlockedAt(
        AccountStatus.block(BlockReason.Manual, null),
        NOW,
      ),
    ).toBe(true);
  });

  it('isBlockedAt() — a temporary block auto-clears once until has passed', () => {
    const future = AccountStatus.block(
      BlockReason.FraudSuspect,
      NOW + minutes(5),
    );
    const past = AccountStatus.block(
      BlockReason.FraudSuspect,
      NOW - minutes(5),
    );
    expect(AccountStatus.isBlockedAt(future, NOW)).toBe(true);
    expect(AccountStatus.isBlockedAt(past, NOW)).toBe(false);
  });

  it('isBlockedAt() — the expiry instant itself is already clear', () => {
    const status = AccountStatus.block(BlockReason.Manual, NOW);
    expect(AccountStatus.isBlockedAt(status, NOW - 1)).toBe(true);
    expect(AccountStatus.isBlockedAt(status, NOW)).toBe(false);
  });
});

describe('BlockReason', () => {
  it('is v2’s vocabulary, each once', () => {
    expect([...BLOCK_REASONS].sort()).toEqual(
      [
        'excessive_failed_attempts',
        'fraud_suspect',
        'manual',
        'terms_violation',
      ].sort(),
    );
    expect(new Set(BLOCK_REASONS).size).toBe(BLOCK_REASONS.length);
  });

  it('isBlockReason narrows known reasons and rejects strangers', () => {
    expect(AccountStatus.isBlockReason('manual')).toBe(true);
    expect(AccountStatus.isBlockReason('fraud_suspect')).toBe(true);
    expect(AccountStatus.isBlockReason('bogus_reason')).toBe(false);
    expect(AccountStatus.isBlockReason(7)).toBe(false);
  });

  it('parseBlockReason accepts a known reason', () => {
    const result = AccountStatus.parseBlockReason('terms_violation');
    expect(result).toEqual({ ok: true, value: 'terms_violation' });
  });

  it('parseBlockReason rejects an unknown reason with the accounts code', () => {
    const result = AccountStatus.parseBlockReason('made_up');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: AccountsErrorCode.BlockReasonInvalid,
        attempted: 'made_up',
      });
    }
  });
});
