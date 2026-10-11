import type { RedemptionCount } from '@core/components';
import type { InvitationId, UserId, UtcEpochMs } from '@core/primitives';

/**
 * `invitations/{id}` — an invitation a user issued; the id IS the shareable
 * code, so anyone with the link can try to redeem it. The stored body of
 * `invitation.adapter.ts:17-24`: no `code` and no `status` (neither is
 * stored). `inviterUserId` stays a `UserId` — referral is an account act
 * (D29). `redemptionCount` is server-written, together with the
 * `redemptions/{refereeUserId}` document, by the `redeemInvitation`
 * pipeline (ReferralSystem refuses self-redemption).
 */
export type Invitation = {
  readonly id: InvitationId;
  readonly inviterUserId: UserId;
  /** Trimmed, never blank. */
  readonly inviterName: string;
  readonly redemptionCount: RedemptionCount;
  readonly createdAtUtcMs: UtcEpochMs;
};
