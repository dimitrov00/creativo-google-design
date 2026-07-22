/**
 * Compile-only type-level assertions (blueprint §2.2/§7): a plain string
 * must never satisfy a branded id, and distinct branded ids must never
 * be structurally interchangeable. This file has no runtime assertions —
 * `tsc` failing on a missing `@ts-expect-error` IS the test.
 */
import {
  AchievementId,
  CouponGrantId,
  CouponId,
  InvitationId,
  MilestoneId,
  RewardProgramId,
} from './ids';

function takesCouponId(_id: CouponId): void {
  // no-op — signature-only fixture
}

function takesInvitationId(_id: InvitationId): void {
  // no-op — signature-only fixture
}

// (a) a bare string is rejected wherever a branded id is expected.
// @ts-expect-error — a raw string is not a CouponId
takesCouponId('not-a-coupon-id');
// @ts-expect-error — a raw string is not an InvitationId
takesInvitationId('not-an-invitation-id');

// (b) distinct branded ids are not interchangeable, even though every
// one of them wraps a plain string at runtime.
declare const couponId: CouponId;
declare const invitationId: InvitationId;
declare const couponGrantId: CouponGrantId;
declare const milestoneId: MilestoneId;
declare const rewardProgramId: RewardProgramId;
declare const achievementId: AchievementId;

// @ts-expect-error — CouponId cannot substitute where InvitationId is required
takesInvitationId(couponId);
// @ts-expect-error — InvitationId cannot substitute where CouponId is required
takesCouponId(invitationId);

function takesMilestoneId(_id: MilestoneId): void {
  // no-op — signature-only fixture
}
// @ts-expect-error — RewardProgramId cannot substitute where MilestoneId is required
takesMilestoneId(rewardProgramId);
// @ts-expect-error — AchievementId cannot substitute where CouponGrantId is required
takesCouponGrantId(achievementId);

function takesCouponGrantId(_id: CouponGrantId): void {
  // no-op — signature-only fixture
}
