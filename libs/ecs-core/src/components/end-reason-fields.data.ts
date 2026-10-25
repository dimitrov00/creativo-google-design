import type { UserId } from '@core/primitives';

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
