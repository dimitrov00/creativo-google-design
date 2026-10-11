import { describe, expect, it } from 'vitest';
import { RedemptionCount } from '../components/redemption-count.data';
import type { Invitation } from '../entities/invitation.entity';
import { InvitationId, UserId } from '../primitives/ids.primitive';
import { deepFreeze, utcMs } from '../testing';
import { ReferralSystem } from './referral.system';

/*
 * COPIED, never moved (the legacy specs keep running against the shims):
 * the `recordRedemption` and `isSelfInvitation` cases of
 * libs/domain/engagement/src/lib/invitation.spec.ts, the `forInvitation`
 * cases of invitation-redemption.spec.ts, and the decision half of
 * libs/application/engagement/src/lib/use-cases/redeem-invitation.use-case.spec.ts
 * (the counter bump and the self-redemption refusal; «not found» is the
 * pipeline's read, not the system's). Re-targeted to the flat
 * `Invitation`. Not copied: the factories' blank-id and blank-name cases —
 * the edge guards' (`XId.of` after a guard), not the referral's.
 */

function invitation(inviterUserId: string): Invitation {
  return {
    id: InvitationId.of('invite-1'),
    inviterUserId: UserId.of(inviterUserId),
    inviterName: 'Ivan',
    redemptionCount: RedemptionCount.zero(),
    createdAtUtcMs: utcMs('2026-01-01T00:00:00Z'),
  };
}

describe('ReferralSystem.recordRedemption', () => {
  it('increments the redemption count, returning a new struct', () => {
    const created = invitation('user_owner');
    const bumped = ReferralSystem.recordRedemption(created);
    expect(bumped.redemptionCount).toBe(1);
    expect(created.redemptionCount).toBe(0);
  });
});

describe('ReferralSystem.isSelfInvitation', () => {
  it('detects when the candidate is the inviter', () => {
    const created = invitation('user_owner');
    expect(
      ReferralSystem.isSelfInvitation(created, UserId.of('user_owner')),
    ).toBe(true);
    expect(
      ReferralSystem.isSelfInvitation(created, UserId.of('user_referee')),
    ).toBe(false);
  });
});

describe('ReferralSystem.redeem', () => {
  it('rejects the inviter redeeming their own invitation', () => {
    const result = ReferralSystem.redeem(
      invitation('user_owner'),
      UserId.of('user_owner'),
      utcMs('2026-01-02T00:00:00Z'),
    );
    expect(result).toEqual({
      ok: false,
      error: { errorCode: 'ENGAGEMENT_INVITATION_SELF_REDEMPTION' },
    });
  });

  it('accepts a different user: records the redemption and bumps the invitation counter', () => {
    const result = ReferralSystem.redeem(
      invitation('user_owner'),
      UserId.of('user_referee'),
      utcMs('2026-01-02T00:00:00Z'),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.invitation.redemptionCount).toBe(1);
      expect(result.value.redemption).toEqual({
        id: 'user_referee',
        redeemedAtUtcMs: utcMs('2026-01-02T00:00:00Z'),
      });
    }
  });
});

describe('ReferralSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const held = deepFreeze(invitation('user_owner'));
    const run = () =>
      ReferralSystem.redeem(
        held,
        UserId.of('user_referee'),
        utcMs('2026-01-02T00:00:00Z'),
      );
    expect(run()).toEqual(run());
    expect(held.redemptionCount).toBe(0);
  });
});
