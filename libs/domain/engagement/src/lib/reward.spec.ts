import { describe, expect, it } from 'vitest';
import { Points } from './points';
import { CouponId } from './ids';
import { Reward } from './reward';

describe('Reward', () => {
  it('constructs a points award', () => {
    const points = Points.create(100);
    if (points.isFailure()) throw new Error('bad fixture');
    const reward = Reward.points(points.value);
    expect(reward.kind).toBe('points');
    expect(reward.amount.amount).toBe(100);
  });

  it('constructs a coupon reward', () => {
    const couponId = CouponId.generate();
    const reward = Reward.coupon(couponId);
    expect(reward.kind).toBe('coupon');
    expect(reward.couponId.equals(couponId)).toBe(true);
  });
});
