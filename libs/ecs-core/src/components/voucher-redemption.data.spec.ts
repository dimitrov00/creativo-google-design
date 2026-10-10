import { describe, expect, it } from 'vitest';
import { GiftVoucherId } from '../entities/gift-voucher.entity';
import { VoucherRedemption } from './voucher-redemption.data';

const LIVE: VoucherRedemption = {
  voucherId: GiftVoucherId.of('gv-1'),
  code: 'GIFT-50',
  amount: { amountMinorUnits: 2000, currencyCode: 'EUR' },
  balanceAfter: { amountMinorUnits: 3000, currencyCode: 'EUR' },
  appliedAtMs: 10,
  reversedAtMs: null,
};

describe('VoucherRedemption', () => {
  it('pays the bill while live', () => {
    expect(VoucherRedemption.isLive(LIVE)).toBe(true);
    expect(VoucherRedemption.restoreDelta(LIVE)).toEqual({
      amountMinorUnits: 2000,
      currencyCode: 'EUR',
    });
  });

  it('keeps a reversed line as history that counts for nothing', () => {
    const reversed = VoucherRedemption.reversed(LIVE, 20);
    expect(reversed).toEqual({ ...LIVE, reversedAtMs: 20 });
    expect(VoucherRedemption.isLive(reversed)).toBe(false);
    // A second reversal restores nothing: the money already went back.
    expect(VoucherRedemption.restoreDelta(reversed)).toEqual({
      amountMinorUnits: 0,
      currencyCode: 'EUR',
    });
    expect(LIVE.reversedAtMs).toBeNull();
  });
});
