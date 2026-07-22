import { describe, expect, it } from 'vitest';
import { CouponCombinability } from './coupon-combinability';

describe('CouponCombinability', () => {
  it('anything can join an empty selection', () => {
    expect(
      CouponCombinability.canAdd([], CouponCombinability.exclusive()),
    ).toBe(true);
    expect(
      CouponCombinability.canAdd([], CouponCombinability.stackable()),
    ).toBe(true);
  });

  it('an exclusive candidate cannot join a non-empty selection', () => {
    expect(
      CouponCombinability.canAdd(
        [CouponCombinability.stackable()],
        CouponCombinability.exclusive(),
      ),
    ).toBe(false);
  });

  it('a stackable candidate cannot join a selection already containing exclusive', () => {
    expect(
      CouponCombinability.canAdd(
        [CouponCombinability.exclusive()],
        CouponCombinability.stackable(),
      ),
    ).toBe(false);
  });

  it('stackables freely combine with each other', () => {
    expect(
      CouponCombinability.canAdd(
        [CouponCombinability.stackable()],
        CouponCombinability.stackable(),
      ),
    ).toBe(true);
  });

  it('isLegalSelection rejects an exclusive coupled with anything else', () => {
    expect(
      CouponCombinability.isLegalSelection([
        CouponCombinability.exclusive(),
        CouponCombinability.stackable(),
      ]),
    ).toBe(false);
  });

  it('isLegalSelection accepts a lone exclusive or any number of stackables', () => {
    expect(
      CouponCombinability.isLegalSelection([CouponCombinability.exclusive()]),
    ).toBe(true);
    expect(
      CouponCombinability.isLegalSelection([
        CouponCombinability.stackable(),
        CouponCombinability.stackable(),
      ]),
    ).toBe(true);
    expect(CouponCombinability.isLegalSelection([])).toBe(true);
  });
});
