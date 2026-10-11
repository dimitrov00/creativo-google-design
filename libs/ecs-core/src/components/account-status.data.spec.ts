import { describe, expect, it } from 'vitest';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { utcMs } from '../testing';
import { AccountsErrorCode } from './accounts-errors.data';
import {
  AccountLifecycle,
  AccountStatus,
  BLOCK_REASONS,
  BlockReason,
} from './account-status.data';

/*
 * The cases of libs/domain/accounts/src/lib/account-status.spec.ts and
 * block-reason.spec.ts, copied (not moved — the class path keeps its own
 * specs until Phase 4) and run against the flat lifecycle slice: instants
 * are `UtcEpochMs`, and a permanent block carries `blockedUntilUtcMs: null`
 * instead of omitting it.
 */

/** 2026-07-22T12:00:00 Europe/Sofia (UTC+3) as a literal instant. */
const NOW = utcMs('2026-07-22T12:00:00+03:00');
const minutesFrom = (at: UtcEpochMs, n: number): UtcEpochMs =>
  UtcEpochMs.plusMs(at, n * 60_000);

describe('AccountLifecycle', () => {
  it('active() is a shared singleton (no reason field)', () => {
    expect(AccountLifecycle.active()).toEqual({ accountStatus: 'ACTIVE' });
    expect(AccountLifecycle.active()).toBe(AccountLifecycle.active());
    expect(AccountLifecycle.unblock()).toBe(AccountLifecycle.active());
  });

  it('block() carries the reason and a null until when permanent', () => {
    const lifecycle = AccountLifecycle.block(BlockReason.TermsViolation, null);
    expect(lifecycle).toEqual({
      accountStatus: 'BLOCKED',
      blockReason: 'TERMS_VIOLATION',
      blockedUntilUtcMs: null,
    });
  });

  it('block() with an until keeps the expiry', () => {
    const untilUtcMs = minutesFrom(NOW, 60);
    const lifecycle = AccountLifecycle.block(
      BlockReason.ExcessiveFailedAttempts,
      untilUtcMs,
    );
    expect(lifecycle.accountStatus).toBe(AccountStatus.Blocked);
    expect(lifecycle.blockedUntilUtcMs).toBe(untilUtcMs);
  });

  it('isBlockedAt() — active is never blocked', () => {
    expect(AccountLifecycle.isBlockedAt(AccountLifecycle.active(), NOW)).toBe(
      false,
    );
  });

  it('isBlockedAt() — a permanent block is always blocked', () => {
    expect(
      AccountLifecycle.isBlockedAt(
        AccountLifecycle.block(BlockReason.Manual, null),
        NOW,
      ),
    ).toBe(true);
  });

  it('isBlockedAt() — a temporary block auto-clears once until has passed', () => {
    const future = AccountLifecycle.block(
      BlockReason.FraudSuspect,
      minutesFrom(NOW, 5),
    );
    const past = AccountLifecycle.block(
      BlockReason.FraudSuspect,
      minutesFrom(NOW, -5),
    );
    expect(AccountLifecycle.isBlockedAt(future, NOW)).toBe(true);
    expect(AccountLifecycle.isBlockedAt(past, NOW)).toBe(false);
  });

  it('isBlockedAt() — the expiry instant itself is already clear', () => {
    const lifecycle = AccountLifecycle.block(BlockReason.Manual, NOW);
    expect(
      AccountLifecycle.isBlockedAt(lifecycle, UtcEpochMs.plusMs(NOW, -1)),
    ).toBe(true);
    expect(AccountLifecycle.isBlockedAt(lifecycle, NOW)).toBe(false);
  });
});

describe('BlockReason', () => {
  it('is v2’s vocabulary, upper-snaked, each once', () => {
    expect([...BLOCK_REASONS].sort()).toEqual(
      [
        'EXCESSIVE_FAILED_ATTEMPTS',
        'FRAUD_SUSPECT',
        'MANUAL',
        'TERMS_VIOLATION',
      ].sort(),
    );
    expect(new Set(BLOCK_REASONS).size).toBe(BLOCK_REASONS.length);
  });

  it('isBlockReason narrows known reasons and rejects strangers', () => {
    expect(AccountLifecycle.isBlockReason('MANUAL')).toBe(true);
    expect(AccountLifecycle.isBlockReason('FRAUD_SUSPECT')).toBe(true);
    expect(AccountLifecycle.isBlockReason('BOGUS_REASON')).toBe(false);
    // The pre-flatten lowercase spelling is a stranger now — shims convert.
    expect(AccountLifecycle.isBlockReason('manual')).toBe(false);
    expect(AccountLifecycle.isBlockReason(7)).toBe(false);
  });

  it('parseBlockReason accepts a known reason', () => {
    const result = AccountLifecycle.parseBlockReason('TERMS_VIOLATION');
    expect(result).toEqual({ ok: true, value: 'TERMS_VIOLATION' });
  });

  it('parseBlockReason rejects an unknown reason with the accounts code', () => {
    const result = AccountLifecycle.parseBlockReason('made_up');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        errorCode: AccountsErrorCode.BlockReasonInvalid,
        attempted: 'made_up',
      });
    }
  });
});
