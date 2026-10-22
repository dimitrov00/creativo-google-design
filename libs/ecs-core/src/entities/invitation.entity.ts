import type { RedemptionCount } from '@core/components';
import type { InvitationId, UserId, UtcEpochMs } from '@core/primitives';

/**
 * `invitations/{id}` — an invitation a user issued; the id IS the shareable
 * code, so anyone with the link can try to redeem it. No `code` and no
 * `status` are stored. `inviterUserId` stays a `UserId` for good — referral
 * is an account act (D29). No reader or writer exists today (the referral
 * surface is off); `redemptionCount` will be server-written, together with
 * the `redemptions/{refereeUserId}` document, in ONE commit by Phase 4's
 * `redeemInvitation` pipeline (ReferralSystem refuses self-redemption).
 */
export type Invitation = {
  readonly id: InvitationId;
  readonly inviterUserId: UserId;
  /** Trimmed, never blank. */
  readonly inviterName: string;
  readonly redemptionCount: RedemptionCount;
  readonly createdAtUtcMs: UtcEpochMs;
};
