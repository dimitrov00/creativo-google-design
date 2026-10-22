import type { UserId, UtcEpochMs } from '@core/primitives';

/**
 * `invitations/{invitationId}/redemptions/{refereeUserId}` — a record that
 * one user redeemed an invitation. The id is the REFEREE's `UserId` for
 * good — referral is an account act (D29) — and that is the idempotency
 * guard: a `Create` of it fails the second redemption by the same referee
 * (engagement Q5 — the subcollection stays, nothing queries redemptions
 * across invitations). Written by Phase 4's `redeemInvitation` pipeline;
 * no writer exists today.
 */
export type InvitationRedemption = {
  readonly id: UserId;
  readonly redeemedAtUtcMs: UtcEpochMs;
};
