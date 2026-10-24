import { describe, expect, it } from 'vitest';
import {
  Currency,
  GiftVoucherId,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { VoucherCode } from './voucher-code.data';
import { VoucherRedemption } from './voucher-redemption.data';

const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

const LIVE: VoucherRedemption = {
  voucherId: GiftVoucherId.of('gv-1'),
  code: VoucherCode.of('GIFT-50'),
  amountCents: unwrapOk(PriceCents.of(2000)),
  balanceAfterCents: unwrapOk(PriceCents.of(3000)),
  currency: Currency.EUR,
  appliedAtUtcMs: at(10),
  reversedAtUtcMs: null,
};

describe('VoucherRedemption', () => {
  it('pays the bill while live', () => {
    expect(VoucherRedemption.isLive(LIVE)).toBe(true);
    expect(VoucherRedemption.restoreDelta(LIVE)).toBe(2000);
  });

  it('keeps a reversed line as history that counts for nothing', () => {
    const reversed = VoucherRedemption.reversed(LIVE, at(20));
    expect(reversed).toEqual({ ...LIVE, reversedAtUtcMs: 20 });
    expect(VoucherRedemption.isLive(reversed)).toBe(false);
    // A second reversal restores nothing: the money already went back.
    expect(VoucherRedemption.restoreDelta(reversed)).toBe(0);
    expect(LIVE.reversedAtUtcMs).toBeNull();
  });

  it('may still draw what it left plus its own amount while live — what it left once reversed', () => {
    expect(VoucherRedemption.drawableCents(LIVE)).toBe(5000);
    expect(
      VoucherRedemption.drawableCents(VoucherRedemption.reversed(LIVE, at(20))),
    ).toBe(3000);
  });
});
