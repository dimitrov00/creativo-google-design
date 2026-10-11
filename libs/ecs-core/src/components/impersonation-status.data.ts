import type { UserId, UtcEpochMs } from '@core/primitives';

/**
 * Session status tags — the ONLY source of these strings, the discriminator
 * `impersonationStatus` of {@link ImpersonationLifecycle} (today's stored
 * `impersonationSessions.status.kind`, upper-snaked; flatten-spec §3.7).
 */
export const ImpersonationStatus = {
  Active: 'ACTIVE',
  Ended: 'ENDED',
} as const;
export type ImpersonationStatus =
  (typeof ImpersonationStatus)[keyof typeof ImpersonationStatus];

/**
 * End-reason tags — the discriminator `impersonationEndReason` of
 * {@link EndReasonFields} (today's stored `status.reason.kind`, upper-snaked).
 */
export const ImpersonationEndReason = {
  /** An admin ended it (`endedByUserId`). */
  AdminEnded: 'ADMIN_ENDED',
  /** Its window ran out and something materialized the end. */
  Expired: 'EXPIRED',
  /** Security revoked it (`revokedByUserId`, with `revocationNotes`). */
  RevokedBySecurity: 'REVOKED_BY_SECURITY',
} as const;
export type ImpersonationEndReason =
  (typeof ImpersonationEndReason)[keyof typeof ImpersonationEndReason];

/**
 * Why a session ended — cause plus the responsible account, no free-text
 * escape hatch (v2's `ImpersonationSession.EndReason`): a union of flat
 * variant slices, flattened onto the ended session's root (Law 6).
 */
export type EndReasonFields =
  | EndReasonFields.AdminEnded
  | EndReasonFields.Expired
  | EndReasonFields.RevokedBySecurity;

const EXPIRED: EndReasonFields.Expired = {
  impersonationEndReason: ImpersonationEndReason.Expired,
};

export const EndReasonFields = {
  adminEnded(endedByUserId: UserId): EndReasonFields.AdminEnded {
    return {
      impersonationEndReason: ImpersonationEndReason.AdminEnded,
      endedByUserId,
    };
  },
  expired(): EndReasonFields.Expired {
    return EXPIRED;
  },
  revokedBySecurity(
    revokedByUserId: UserId,
    revocationNotes: string,
  ): EndReasonFields.RevokedBySecurity {
    return {
      impersonationEndReason: ImpersonationEndReason.RevokedBySecurity,
      revokedByUserId,
      revocationNotes,
    };
  },
} as const;

export namespace EndReasonFields {
  export type AdminEnded = {
    readonly impersonationEndReason: typeof ImpersonationEndReason.AdminEnded;
    readonly endedByUserId: UserId;
  };
  export type Expired = {
    readonly impersonationEndReason: typeof ImpersonationEndReason.Expired;
  };
  export type RevokedBySecurity = {
    readonly impersonationEndReason: typeof ImpersonationEndReason.RevokedBySecurity;
    readonly revokedByUserId: UserId;
    readonly revocationNotes: string;
  };
}

/**
 * The lifecycle slice of an impersonation session — `ENDED` structurally
 * CARRIES its instant and reason (flat at the session's root), so an active
 * session can never hold a dangling end reason. The expiry rule is not here:
 * a stored `ACTIVE` row may be past `expiresAtUtcMs`, and
 * `ImpersonationSystem.isExpired` is what an authorization decision reads.
 */
export type ImpersonationLifecycle =
  ImpersonationLifecycle.Active | ImpersonationLifecycle.Ended;

const ACTIVE: ImpersonationLifecycle.Active = {
  impersonationStatus: ImpersonationStatus.Active,
};

export const ImpersonationLifecycle = {
  active(): ImpersonationLifecycle.Active {
    return ACTIVE;
  },

  /**
   * Close an active lifecycle at `endedAtUtcMs` for `reason` — or `null`
   * when it already ended: the first end wins, and the caller (which knows
   * the session id) words the refusal
   * `GOVERNANCE_IMPERSONATION_SESSION_ALREADY_ENDED`.
   */
  end(
    lifecycle: ImpersonationLifecycle,
    endedAtUtcMs: UtcEpochMs,
    reason: EndReasonFields,
  ): ImpersonationLifecycle.Ended | null {
    if (lifecycle.impersonationStatus !== ImpersonationStatus.Active) {
      return null;
    }
    return {
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs,
      ...reason,
    };
  },

  isActive(
    lifecycle: ImpersonationLifecycle,
  ): lifecycle is ImpersonationLifecycle.Active {
    return lifecycle.impersonationStatus === ImpersonationStatus.Active;
  },
} as const;

export namespace ImpersonationLifecycle {
  export type Active = {
    readonly impersonationStatus: typeof ImpersonationStatus.Active;
  };
  export type Ended = {
    readonly impersonationStatus: typeof ImpersonationStatus.Ended;
    readonly endedAtUtcMs: UtcEpochMs;
  } & EndReasonFields;
}
