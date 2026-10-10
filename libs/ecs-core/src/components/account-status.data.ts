import { AccountsError } from './accounts-errors.data';
import { Result } from './result.data';

/** Status tags — the ONLY source of these strings (`users.accountStatus.kind`). */
export const AccountState = {
  /** Normal; the only status that may use the app. */
  Active: 'active',
  /** Denied — temporarily when `untilMs` is set, permanently when it is `null`. */
  Blocked: 'blocked',
} as const;
export type AccountState = (typeof AccountState)[keyof typeof AccountState];

/**
 * Why an account was blocked — a closed vocabulary, v2's `BlockReason`
 * verbatim; a new reason is a deliberate code change.
 */
export const BlockReason = {
  ExcessiveFailedAttempts: 'excessive_failed_attempts',
  TermsViolation: 'terms_violation',
  FraudSuspect: 'fraud_suspect',
  Manual: 'manual',
} as const;
export type BlockReason = (typeof BlockReason)[keyof typeof BlockReason];

/** Every block reason, dictionary order — derived, never a second source. */
export const BLOCK_REASONS: readonly BlockReason[] = Object.values(BlockReason);

/**
 * The live, REVOCABLE authorization status of an account — a discriminated
 * union, not an `isBlocked` boolean, so "blocked but no reason" is
 * unrepresentable. Stored as `users.accountStatus` (today's `status`,
 * blueprint §3.1): `{ kind: 'active' }` or `{ kind: 'blocked', reason,
 * untilMs }`, where `untilMs` is the temporary block's expiry in epoch ms and
 * `null` means permanent (today's omitted `until`).
 */
export type AccountStatus = AccountStatus.Active | AccountStatus.Blocked;

/** The one active status — every active account shares this struct. */
const ACTIVE: AccountStatus.Active = { kind: AccountState.Active };

export const AccountStatus = {
  active(): AccountStatus.Active {
    return ACTIVE;
  },

  /** Block for `reason`, until `untilMs` (exclusive), or for good when `null`. */
  block(reason: BlockReason, untilMs: number | null): AccountStatus.Blocked {
    return { kind: AccountState.Blocked, reason, untilMs };
  },

  /** Lift any block. */
  unblock(): AccountStatus.Active {
    return ACTIVE;
  },

  /**
   * Whether the status denies app access AS OF `nowMs`. A temporary block
   * whose `untilMs` has come is treated as active — it auto-clears, nothing
   * has to rewrite it. The caller passes the instant, so the check is pure.
   */
  isBlockedAt(status: AccountStatus, nowMs: number): boolean {
    if (status.kind === AccountState.Active) return false;
    if (status.untilMs === null) return true;
    return status.untilMs > nowMs;
  },

  /** The edge guard for an untrusted reason (an admin's dropdown pick, a stored string). */
  isBlockReason(value: unknown): value is BlockReason {
    for (let i = 0; i < BLOCK_REASONS.length; i++) {
      if (BLOCK_REASONS[i] === value) return true;
    }
    return false;
  },

  /** The edge guard with a refusal: a known reason, or `accounts.block_reason.invalid`. */
  parseBlockReason(raw: string): Result<BlockReason, AccountsError> {
    return AccountStatus.isBlockReason(raw)
      ? Result.ok(raw)
      : Result.err(AccountsError.blockReasonInvalid(raw));
  },
} as const;

export namespace AccountStatus {
  export type Active = {
    readonly kind: typeof AccountState.Active;
  };
  export type Blocked = {
    readonly kind: typeof AccountState.Blocked;
    readonly reason: BlockReason;
    /** Temporary block expiry (epoch ms, exclusive); `null` = permanent. */
    readonly untilMs: number | null;
  };
}
