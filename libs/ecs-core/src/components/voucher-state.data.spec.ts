import { describe, expect, it } from 'vitest';
import {
  VoucherRefusal,
  VoucherState,
  VoucherStateKind,
} from './voucher-state.data';

describe('VoucherState', () => {
  it('keeps the stored tags and the refusal reasons', () => {
    expect(Object.values(VoucherStateKind)).toEqual(['active', 'void']);
    expect(Object.values(VoucherRefusal)).toEqual(['void', 'expired', 'empty']);
  });

  it('is active until voided, with when and why', () => {
    const active = VoucherState.active();
    const voided = VoucherState.voided(1_760_000_000_000, 'sold in error');
    expect(active).toEqual({ kind: 'active' });
    expect(voided).toEqual({
      kind: 'void',
      voidedAtMs: 1_760_000_000_000,
      reason: 'sold in error',
    });
    expect(VoucherState.isVoid(active)).toBe(false);
    expect(VoucherState.isVoid(voided)).toBe(true);
  });
});
