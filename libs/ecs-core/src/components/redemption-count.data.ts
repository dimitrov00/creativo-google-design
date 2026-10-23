import { type Brand, Result } from '@core/primitives';
import { EngagementError } from '@core/errors';

/**
 * How many people redeemed an invitation — `invitations.redemptionCount`, a
 * brand over a non-negative integer (`invitation.ts`). SERVER-WRITTEN: the
 * `redeemInvitation` pipeline writes the bumped count and the
 * `redemptions/{refereeUserId}` document in ONE plan (§3.1), so the counter
 * and the documents cannot drift — never a raw client `+1`.
 */
export type RedemptionCount = Brand<number, 'RedemptionCount'>;

export const RedemptionCount = {
  /** The only cast site, for a stored count. Untrusted input goes through `parse`. */
  of(raw: number): RedemptionCount {
    return raw as RedemptionCount;
  },

  /** A fresh invitation always starts with none. */
  zero(): RedemptionCount {
    return RedemptionCount.of(0);
  },

  /** The edge guard: a non-negative integer. */
  parse(
    raw: number,
  ): Result<RedemptionCount, EngagementError.InvitationRedemptionCountInvalid> {
    return Number.isInteger(raw) && raw >= 0
      ? Result.ok(RedemptionCount.of(raw + 0))
      : Result.err(EngagementError.invitationRedemptionCountInvalid(raw));
  },

  /** One more redemption — the per-redemption bump (`Invitation.recordRedemption`). */
  next(count: RedemptionCount): RedemptionCount {
    return RedemptionCount.of(count + 1);
  },
} as const;
