import { UtcEpochMs, Result, Tag } from '@core/primitives';
import { AccountsError } from '@core/errors';

/**
 * Account status tags — the ONLY source of these strings, the discriminator
 * `accountStatus` of {@link AccountLifecycle} (flatten-spec §3.7).
 */
export const AccountStatus = {
  /** Normal; the only status that may use the app. */
  Active: 'ACTIVE',
  /** Denied — temporarily when `blockedUntilUtcMs` is set, permanently when it is `null`. */
  Blocked: 'BLOCKED',
  /**
   * Erased under Art. 17 (audit-hardening Phase 3 WS-D, P3-RU-17): terminal,
   * never reverts — the account's personal values are cleared, its Auth
   * user deleted, and every reader denies it for good.
   */
  Erased: 'ERASED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/**
 * Why an account was blocked — a closed vocabulary, v2's `BlockReason`
 * upper-snaked; a new reason is a deliberate code change. The field is
 * `blockReason`.
 */
export const BlockReason = {
  ExcessiveFailedAttempts: 'EXCESSIVE_FAILED_ATTEMPTS',
  TermsViolation: 'TERMS_VIOLATION',
  FraudSuspect: 'FRAUD_SUSPECT',
  Manual: 'MANUAL',
} as const;
export type BlockReason = (typeof BlockReason)[keyof typeof BlockReason];

/**
 * The live authorization status of an account — a union of flat variant
 * slices (Law 6), not an `isBlocked` boolean, so "blocked but no reason" is
 * unrepresentable. Intersected into `User` at the root: the blocked
 * variant's `blockReason` and `blockedUntilUtcMs` are root fields of the
 * account. `blockedUntilUtcMs` is the temporary block's expiry (exclusive);
 * `null` means permanent. `ACTIVE` and `BLOCKED` are REVOCABLE; `ERASED`
 * (with its `accountErasedAtUtcMs`) is terminal — no move leaves it.
 */
export type AccountLifecycle =
  AccountLifecycle.Active | AccountLifecycle.Blocked | AccountLifecycle.Erased;

/** The one active slice — every active account shares this struct. */
const ACTIVE: AccountLifecycle.Active = { accountStatus: AccountStatus.Active };

export const AccountLifecycle = {
  /** Every block reason, dictionary order — derived, never a second source. */
  BLOCK_REASONS: Tag.values(BlockReason),

  active(): AccountLifecycle.Active {
    return ACTIVE;
  },

  /** Block for `blockReason`, until `blockedUntilUtcMs` (exclusive), or for good when `null`. */
  block(
    blockReason: BlockReason,
    blockedUntilUtcMs: UtcEpochMs | null,
  ): AccountLifecycle.Blocked {
    return {
      accountStatus: AccountStatus.Blocked,
      blockReason,
      blockedUntilUtcMs,
    };
  },

  /** Lift any block. */
  unblock(): AccountLifecycle.Active {
    return ACTIVE;
  },

  /**
   * Erased at `accountErasedAtUtcMs` (Art. 17, P3-RU-17) — the terminal
   * variant the erasure's stamp commit moves the account to.
   */
  erase(accountErasedAtUtcMs: UtcEpochMs): AccountLifecycle.Erased {
    return { accountStatus: AccountStatus.Erased, accountErasedAtUtcMs };
  },

  /** The account was erased — terminal, whatever the instant. */
  isErased(lifecycle: AccountLifecycle): boolean {
    return lifecycle.accountStatus === AccountStatus.Erased;
  },

  /**
   * Whether the lifecycle denies app access AS OF `nowUtcMs` (a T2 row:
   * an expiry compared in elapsed real time). A temporary block whose
   * `blockedUntilUtcMs` has come is treated as active — it auto-clears,
   * nothing has to rewrite it; an erased account is denied for good. The
   * caller passes the instant, so the check is pure.
   */
  isBlockedAt(lifecycle: AccountLifecycle, nowUtcMs: UtcEpochMs): boolean {
    switch (lifecycle.accountStatus) {
      case AccountStatus.Active:
        return false;
      case AccountStatus.Erased:
        return true;
      case AccountStatus.Blocked:
        if (lifecycle.blockedUntilUtcMs === null) return true;
        return UtcEpochMs.compare(lifecycle.blockedUntilUtcMs, nowUtcMs) > 0;
    }
  },

  /** The edge guard for an untrusted reason (an admin's dropdown pick, a stored string). */
  isBlockReason(value: unknown): value is BlockReason {
    return Tag.has(BlockReason, value);
  },

  /** The edge guard with a refusal: a known reason, or `ACCOUNTS_BLOCK_REASON_INVALID`. */
  parseBlockReason(raw: string): Result<BlockReason, AccountsError> {
    return AccountLifecycle.isBlockReason(raw)
      ? Result.ok(raw)
      : Result.err(AccountsError.blockReasonInvalid(raw));
  },
} as const;

export namespace AccountLifecycle {
  export type Active = {
    readonly accountStatus: typeof AccountStatus.Active;
  };
  export type Blocked = {
    readonly accountStatus: typeof AccountStatus.Blocked;
    readonly blockReason: BlockReason;
    /** Temporary block expiry (exclusive); `null` = permanent. */
    readonly blockedUntilUtcMs: UtcEpochMs | null;
  };
  export type Erased = {
    readonly accountStatus: typeof AccountStatus.Erased;
    /** When the erasure's stamp commit erased the account (a lifecycle stamp, T2). */
    readonly accountErasedAtUtcMs: UtcEpochMs;
  };
}
