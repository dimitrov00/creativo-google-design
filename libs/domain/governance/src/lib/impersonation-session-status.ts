import { ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';

/**
 * Why a session ended. Discriminated union (not a free-text reason
 * string) so the audit trail preserves cause + the responsible actor
 * without an escape hatch — ported from v2's `ImpersonationSession.EndReason`.
 */
export type ImpersonationEndReason =
  | { readonly kind: 'admin_ended'; readonly endedBy: UserId }
  | { readonly kind: 'expired' }
  | {
      readonly kind: 'revoked_by_security';
      readonly revokedBy: UserId;
      readonly notes: string;
    };

export const ImpersonationEndReason = {
  adminEnded: (endedBy: UserId): ImpersonationEndReason => ({
    kind: 'admin_ended',
    endedBy,
  }),
  expired: (): ImpersonationEndReason => ({ kind: 'expired' }),
  revokedBySecurity: (input: {
    revokedBy: UserId;
    notes: string;
  }): ImpersonationEndReason => ({
    kind: 'revoked_by_security',
    revokedBy: input.revokedBy,
    notes: input.notes,
  }),
} as const;

/**
 * A discriminated union, not a status string plus a separate optional
 * `endedAt`/`reason` pair — `ended` structurally *carries* both, so there
 * is no reachable state where an active session has a dangling end
 * reason (mirrors this repo's `AppointmentStatus`/`AccountStatus`
 * precedent). No TS `namespace` — flat top-level types, per the same
 * precedent.
 */
export type ImpersonationSessionStatus =
  | { readonly kind: 'active' }
  | {
      readonly kind: 'ended';
      readonly endedAt: ZonedDateTime;
      readonly reason: ImpersonationEndReason;
    };

export const ACTIVE_IMPERSONATION_STATUS: ImpersonationSessionStatus = {
  kind: 'active',
};

export const ImpersonationSessionStatus = {
  active(): ImpersonationSessionStatus {
    return ACTIVE_IMPERSONATION_STATUS;
  },
  ended(input: {
    endedAt: ZonedDateTime;
    reason: ImpersonationEndReason;
  }): ImpersonationSessionStatus {
    return { kind: 'ended', endedAt: input.endedAt, reason: input.reason };
  },
} as const;
