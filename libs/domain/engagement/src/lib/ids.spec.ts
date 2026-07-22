import { describe, expect, it } from 'vitest';
import {
  AchievementId,
  CouponGrantId,
  CouponId,
  InvitationId,
  MilestoneId,
  RewardProgramId,
} from './ids';

const idClasses = [
  ['CouponId', CouponId],
  ['CouponGrantId', CouponGrantId],
  ['RewardProgramId', RewardProgramId],
  ['MilestoneId', MilestoneId],
  ['InvitationId', InvitationId],
  ['AchievementId', AchievementId],
] as const;

describe.each(idClasses)('%s', (_name, IdClass) => {
  it('creates from a non-empty string', () => {
    const result = IdClass.create('abc-123');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('abc-123');
    }
  });

  it('rejects an empty string', () => {
    const result = IdClass.create('');
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a whitespace-only string', () => {
    const result = IdClass.create('   ');
    expect(result.isFailure()).toBe(true);
  });

  it('generate() produces a fresh, non-empty id', () => {
    const generated = IdClass.generate();
    expect(generated.value.length).toBeGreaterThan(0);
  });

  it('two ids created from the same raw value carry the same underlying value', () => {
    const a = IdClass.create('same-id');
    const b = IdClass.create('same-id');
    if (a.isFailure() || b.isFailure()) throw new Error('bad fixture');
    // `.equals()` isn't called here: across this parametrized suite `IdClass`
    // is a union of six distinct branded classes, and TypeScript can't find
    // a call signature for `equals(other: Id<Brand>)` that satisfies every
    // member at once — comparing the underlying string is an equivalent,
    // type-safe check for this generic table-test. Each id class also has
    // its own dedicated `equals()` exercised in its owning entity's spec.
    expect(a.value.toString()).toBe(b.value.toString());
  });
});
