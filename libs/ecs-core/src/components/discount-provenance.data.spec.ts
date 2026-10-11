import { describe, expect, it } from 'vitest';
import { CouponGrantId } from '@core/primitives';
import { DiscountProvenance, DiscountSource } from './discount-provenance.data';
import { VoucherCode } from './voucher-code.data';

const GRANT = DiscountProvenance.grant(CouponGrantId.of('grant-1'));
const CODE = DiscountProvenance.code(VoucherCode.of('FIRST10'));
const MANUAL = DiscountProvenance.manual();

describe('DiscountSource', () => {
  it('keeps one SCREAMING tag per source', () => {
    expect(Object.values(DiscountSource).sort()).toEqual([
      'CODE',
      'GRANT',
      'MANUAL',
    ]);
  });
});

describe('DiscountProvenance — each source carries its own evidence', () => {
  it('builds flat variants with domain-prefixed evidence and nothing else', () => {
    expect(GRANT).toEqual({
      discountSource: 'GRANT',
      discountGrantId: 'grant-1',
    });
    expect(CODE).toEqual({ discountSource: 'CODE', discountCode: 'FIRST10' });
    expect(MANUAL).toEqual({ discountSource: 'MANUAL' });
  });

  it('reads the grant or the code off its own variant only', () => {
    expect(DiscountProvenance.grantIdOf(GRANT)).toBe('grant-1');
    expect(DiscountProvenance.grantIdOf(CODE)).toBeNull();
    expect(DiscountProvenance.grantIdOf(MANUAL)).toBeNull();
    expect(DiscountProvenance.codeOf(CODE)).toBe('FIRST10');
    expect(DiscountProvenance.codeOf(GRANT)).toBeNull();
    expect(DiscountProvenance.codeOf(MANUAL)).toBeNull();
  });

  it('is the same provenance only for the same source with the same evidence', () => {
    expect(
      DiscountProvenance.sameProvenance(
        GRANT,
        DiscountProvenance.grant(CouponGrantId.of('grant-1')),
      ),
    ).toBe(true);
    expect(
      DiscountProvenance.sameProvenance(
        GRANT,
        DiscountProvenance.grant(CouponGrantId.of('grant-2')),
      ),
    ).toBe(false);
    expect(
      DiscountProvenance.sameProvenance(
        CODE,
        DiscountProvenance.code(VoucherCode.of('FIRST10')),
      ),
    ).toBe(true);
    expect(
      DiscountProvenance.sameProvenance(
        CODE,
        DiscountProvenance.code(VoucherCode.of('BEARD5')),
      ),
    ).toBe(false);
    expect(
      DiscountProvenance.sameProvenance(MANUAL, DiscountProvenance.manual()),
    ).toBe(true);
    for (const [a, b] of [
      [GRANT, CODE],
      [CODE, MANUAL],
      [MANUAL, GRANT],
    ] as const) {
      expect(DiscountProvenance.sameProvenance(a, b)).toBe(false);
      expect(DiscountProvenance.sameProvenance(b, a)).toBe(false);
    }
  });
});
