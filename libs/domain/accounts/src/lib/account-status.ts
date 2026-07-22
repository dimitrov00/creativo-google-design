import { ZonedDateTime } from '@creativo/domain/kernel';
import { BlockReason } from './block-reason';

/**
 * Live, REVOCABLE authorization status of a registered account. Ported
 * from v2's `AccountStatus.ts` — a discriminated union (not an
 * `isBlocked: boolean`) so the illegal state "blocked but no reason" is
 * unrepresentable, mirroring `AppointmentStatus`'s pattern in this
 * repo's own `models` lib (see `docs/architecture/domain-model.md`).
 * `Temporal.Instant` is replaced by this repo's `ZonedDateTime` kernel VO
 * (§2.1/§7.1 of the migration blueprint — no bare `Date`/Temporal here).
 *
 * No TS `namespace` (this repo's ESLint config bans it, see
 * `AppointmentStatus` for the same flat-union precedent) — the
 * `Active`/`Blocked` shapes are plain top-level interfaces instead of a
 * nested `AccountStatus.Active`/`AccountStatus.Blocked`.
 *
 *   - `active`  — normal; the only status that may use the app.
 *   - `blocked` — denied. `until` set ⇒ temporary (auto-clears once
 *     past), absent ⇒ permanent.
 *
 * Constructors here take already-validated domain values (`BlockReason`,
 * `ZonedDateTime`), never raw primitives, so they're pure and never fail
 * — the raw-input door for an admin-supplied reason string is
 * `parseBlockReason` (`block-reason.ts`).
 */
export interface AccountStatusActive {
  readonly kind: 'active';
}

export interface AccountStatusBlocked {
  readonly kind: 'blocked';
  readonly reason: BlockReason;
  /** Temporary block expiry. Absent ⇒ permanent. */
  readonly until?: ZonedDateTime;
}

export type AccountStatus = AccountStatusActive | AccountStatusBlocked;

const ACTIVE: AccountStatusActive = { kind: 'active' };

export const AccountStatus = {
  active(): AccountStatusActive {
    return ACTIVE;
  },

  blocked(input: {
    reason: BlockReason;
    until?: ZonedDateTime;
  }): AccountStatusBlocked {
    return {
      kind: 'blocked',
      reason: input.reason,
      ...(input.until !== undefined && { until: input.until }),
    };
  },

  /**
   * Whether the status denies app access AS OF `at`. A temporary block
   * whose `until` has passed is treated as active (auto-clears) — the
   * caller passes the current instant so the check stays pure (never
   * `ZonedDateTime.now()` internally).
   */
  isBlocked(status: AccountStatus, at: ZonedDateTime): boolean {
    if (status.kind === 'active') return false;
    if (status.until === undefined) return true;
    return status.until.isAfter(at);
  },
} as const;
