import type { CustomerId, UserId } from '@core/primitives';

/**
 * Whom an audited act touched — the target slice of `AuditEntry`, the
 * discriminator `auditTarget` (flatten-spec §3.7, F-26: a variant slice,
 * never a nullable id guarded by a comment). `NONE` when the act touched no
 * person, `USER` for an account act (a profile write, an account change),
 * `CUSTOMER` for a client record — written by the booking acts from the
 * booking flip (1) on (D29, §5.5). In this pass a row's target is `NONE`
 * when today's stored `targetUserId` is `null` and `USER` otherwise
 * (booking acts included); the stored bytes are unchanged.
 */
export const AuditTarget = {
  None: 'NONE',
  User: 'USER',
  Customer: 'CUSTOMER',
} as const;
export type AuditTarget = (typeof AuditTarget)[keyof typeof AuditTarget];

export type AuditTargetRef =
  AuditTargetRef.None | AuditTargetRef.User | AuditTargetRef.Customer;

/** The one no-target slice — every untargeted row shares this struct. */
const NO_TARGET: AuditTargetRef.None = { auditTarget: AuditTarget.None };

export const AuditTargetRef = {
  none(): AuditTargetRef.None {
    return NO_TARGET;
  },
  user(targetUserId: UserId): AuditTargetRef.User {
    return { auditTarget: AuditTarget.User, targetUserId };
  },
  customer(targetCustomerId: CustomerId): AuditTargetRef.Customer {
    return { auditTarget: AuditTarget.Customer, targetCustomerId };
  },
  /** The account an act touched as its target slice: `USER`, or `NONE` for no account. */
  forUser(
    targetUserId: UserId | null,
  ): AuditTargetRef.None | AuditTargetRef.User {
    return targetUserId === null
      ? NO_TARGET
      : AuditTargetRef.user(targetUserId);
  },
  /** The account a target names — `null` for `NONE` and for a client record (D29: never a `UserId`). */
  targetUserIdOf(ref: AuditTargetRef): UserId | null {
    return ref.auditTarget === AuditTarget.User ? ref.targetUserId : null;
  },
} as const;

export namespace AuditTargetRef {
  export type None = {
    readonly auditTarget: typeof AuditTarget.None;
  };
  export type User = {
    readonly auditTarget: typeof AuditTarget.User;
    readonly targetUserId: UserId;
  };
  export type Customer = {
    readonly auditTarget: typeof AuditTarget.Customer;
    readonly targetCustomerId: CustomerId;
  };
}
