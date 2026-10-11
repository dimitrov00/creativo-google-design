import { describe, expect, it } from 'vitest';
import { UtcEpochMs, VoucherRefusal } from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { VoucherLifecycle, VoucherStatus } from './voucher-state.data';

describe('VoucherLifecycle', () => {
  it('keeps one SCREAMING tag per state and refusal reason', () => {
    expect(Object.values(VoucherStatus)).toEqual(['ACTIVE', 'VOID']);
    expect(Object.values(VoucherRefusal)).toEqual(['VOID', 'EXPIRED', 'EMPTY']);
  });

  it('is active until voided, with when and why', () => {
    const active = VoucherLifecycle.active();
    const voided = VoucherLifecycle.voided(
      unwrapOk(UtcEpochMs.of(1_760_000_000_000)),
      'sold in error',
    );
    expect(active).toEqual({ voucherStatus: 'ACTIVE' });
    expect(voided).toEqual({
      voucherStatus: 'VOID',
      voidedAtUtcMs: 1_760_000_000_000,
      voidReason: 'sold in error',
    });
    expect(VoucherLifecycle.isVoid(active)).toBe(false);
    expect(VoucherLifecycle.isVoid(voided)).toBe(true);
    const voucher = { ...voided, balanceCents: 0 };
    expect(VoucherLifecycle.of(voucher)).toEqual(voided);
    expect(VoucherLifecycle.of(active)).toBe(active);
  });
});
