import type { UserId, UtcEpochMs } from '@core/primitives';

/**
 * `invitations/{invitationId}/redemptions/{refereeUserId}` — a record that
 * one user redeemed an invitation (`invitation.adapter.ts:63`). The id is
 * the REFEREE's `UserId` — referral is an account act (D29) — and that is
 * the idempotency guard: `create()` fails the second redemption by the same
 * referee (engagement Q5 — the subcollection stays, nothing queries
 * redemptions across invitations).
 */
export type InvitationRedemption = {
  readonly id: UserId;
  readonly redeemedAtUtcMs: UtcEpochMs;
};
