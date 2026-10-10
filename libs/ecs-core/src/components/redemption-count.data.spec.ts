import { describe, expect, it } from 'vitest';
import { RedemptionCount } from './redemption-count.data';

// The redemption-count cases of `invitation.spec.ts`.

describe('RedemptionCount', () => {
  it('starts a fresh invitation at zero and bumps by one', () => {
    const zero = RedemptionCount.zero();
    expect(zero).toBe(0);
    expect(RedemptionCount.next(zero)).toBe(1);
    expect(RedemptionCount.next(RedemptionCount.of(41))).toBe(42);
  });

  it.each([0, 3])('accepts a stored count of %s', (raw) => {
    expect(RedemptionCount.parse(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([-1, 2.5, Number.NaN])('refuses a count of %s', (raw) => {
    expect(RedemptionCount.parse(raw)).toEqual({
      ok: false,
      error: {
        code: 'engagement.invitation.invalid_redemption_count',
        attempted: raw,
      },
    });
  });
});
