import { describe, expect, it } from 'vitest';
import { VoucherCode } from './voucher-code.data';

// The cases of `voucher-code.spec.ts`, plus the counter's normalisation
// (`Coupon.normalizeCode`, `Coupon.validateCode`).

describe('VoucherCode.parse', () => {
  it('accepts a well-formed code, case preserved', () => {
    expect(VoucherCode.parse('PROMO-2026')).toEqual({
      ok: true,
      value: 'PROMO-2026',
    });
    expect(VoucherCode.parse('MiXeD-Case1')).toEqual({
      ok: true,
      value: 'MiXeD-Case1',
    });
    expect(VoucherCode.parse('a_b4')).toEqual({ ok: true, value: 'a_b4' });
  });

  it.each([
    ['ab'],
    ['abc'],
    ['a'.repeat(33)],
    ['promo 2026!'],
    ['ПРОМО'],
    [''],
  ])('rejects %j', (raw) => {
    expect(VoucherCode.parse(raw)).toEqual({
      ok: false,
      error: { code: 'engagement.voucher_code.invalid', attempted: raw },
    });
  });

  it('takes 4 and 32 characters', () => {
    expect(VoucherCode.parse('abcd').ok).toBe(true);
    expect(VoucherCode.parse('a'.repeat(32)).ok).toBe(true);
  });
});

describe('the counter’s reading', () => {
  it('normalises a typed code: trimmed, upper-case', () => {
    expect(VoucherCode.normalize('  first10 ')).toBe('FIRST10');
    expect(VoucherCode.parseTyped('  first10 ')).toEqual({
      ok: true,
      value: 'FIRST10',
    });
  });

  it('reads no code, or a blank one, as a grant-only coupon', () => {
    expect(VoucherCode.parseOptional(null)).toEqual({ ok: true, value: null });
    expect(VoucherCode.parseOptional('   ')).toEqual({ ok: true, value: null });
    expect(VoucherCode.parseOptional('summer-26')).toEqual({
      ok: true,
      value: 'SUMMER-26',
    });
  });

  it('refuses an optional code that is not one', () => {
    expect(VoucherCode.parseOptional('no!')).toEqual({
      ok: false,
      error: { code: 'engagement.voucher_code.invalid', attempted: 'NO!' },
    });
  });

  it('compares by value', () => {
    expect(
      VoucherCode.equals(
        VoucherCode.of('SAME-CODE'),
        VoucherCode.of('SAME-CODE'),
      ),
    ).toBe(true);
    expect(
      VoucherCode.equals(
        VoucherCode.of('SAME-CODE'),
        VoucherCode.of('same-code'),
      ),
    ).toBe(false);
  });
});
