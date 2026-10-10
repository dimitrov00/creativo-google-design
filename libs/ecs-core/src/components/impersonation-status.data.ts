import type { UserId } from '../entities/user.entity';

/** Session status tags — the ONLY source of these strings (`impersonationSessions.status.kind`). */
export const ImpersonationState = {
  Active: 'active',
  Ended: 'ended',
} as const;
export type ImpersonationState =
  (typeof ImpersonationState)[keyof typeof ImpersonationState];

/** End-reason tags — the stored `status.reason.kind` strings, unchanged. */
export const ImpersonationEndReasonKind = {
  /** An admin ended it (`endedBy`). */
  AdminEnded: 'admin_ended',
  /** Its window ran out and something materialized the end. */
  Expired: 'expired',
  /** Security revoked it (`revokedBy`, with notes). */
  RevokedBySecurity: 'revoked_by_security',
} as const;
export type ImpersonationEndReasonKind =
  (typeof ImpersonationEndReasonKind)[keyof typeof ImpersonationEndReasonKind];

/**
 * Why a session ended — cause plus the responsible actor, no free-text escape
 * hatch (v2's `ImpersonationSession.EndReason`), payloads as stored
 * (`impersonation-session-status.ts:9-16`).
 */
export type ImpersonationEndReason =
  | ImpersonationEndReason.AdminEnded
  | ImpersonationEndReason.Expired
  | ImpersonationEndReason.RevokedBySecurity;

const EXPIRED: ImpersonationEndReason.Expired = {
  kind: ImpersonationEndReasonKind.Expired,
};

export const ImpersonationEndReason = {
  adminEnded(endedBy: UserId): ImpersonationEndReason.AdminEnded {
    return { kind: ImpersonationEndReasonKind.AdminEnded, endedBy };
  },
  expired(): ImpersonationEndReason.Expired {
    return EXPIRED;
  },
  revokedBySecurity(
    revokedBy: UserId,
    notes: string,
  ): ImpersonationEndReason.RevokedBySecurity {
    return {
      kind: ImpersonationEndReasonKind.RevokedBySecurity,
      revokedBy,
      notes,
    };
  },
} as const;

export namespace ImpersonationEndReason {
  export type AdminEnded = {
    readonly kind: typeof ImpersonationEndReasonKind.AdminEnded;
    readonly endedBy: UserId;
  };
  export type Expired = {
    readonly kind: typeof ImpersonationEndReasonKind.Expired;
  };
  export type RevokedBySecurity = {
    readonly kind: typeof ImpersonationEndReasonKind.RevokedBySecurity;
    readonly revokedBy: UserId;
    readonly notes: string;
  };
}

/**
 * The stored `status` of an impersonation session — `ended` structurally
 * CARRIES its instant and reason, so an active session can never hold a
 * dangling end reason. The expiry rule is not here: a stored `active` row may
 * be past `expiresAtMs`, and `ImpersonationSystem.isExpired` is what an
 * authorization decision reads.
 */
export type ImpersonationStatus =
  ImpersonationStatus.Active | ImpersonationStatus.Ended;

const ACTIVE: ImpersonationStatus.Active = {
  kind: ImpersonationState.Active,
};

export const ImpersonationStatus = {
  active(): ImpersonationStatus.Active {
    return ACTIVE;
  },

  /**
   * Close an active status at `endedAtMs` for `reason` — or `null` when it
   * already ended: the first end wins, and the caller (which knows the
   * session id) words the refusal `governance.impersonation_session.already_ended`.
   */
  end(
    status: ImpersonationStatus,
    endedAtMs: number,
    reason: ImpersonationEndReason,
  ): ImpersonationStatus.Ended | null {
    if (status.kind !== ImpersonationState.Active) return null;
    return { kind: ImpersonationState.Ended, endedAtMs, reason };
  },

  isActive(status: ImpersonationStatus): status is ImpersonationStatus.Active {
    return status.kind === ImpersonationState.Active;
  },
} as const;

export namespace ImpersonationStatus {
  export type Active = {
    readonly kind: typeof ImpersonationState.Active;
  };
  export type Ended = {
    readonly kind: typeof ImpersonationState.Ended;
    readonly endedAtMs: number;
    readonly reason: ImpersonationEndReason;
  };
}
