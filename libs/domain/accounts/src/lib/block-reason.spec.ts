import { describe, expect, it } from 'vitest';
import { isBlockReason, parseBlockReason } from './block-reason';

describe('isBlockReason', () => {
  it('narrows known reasons and rejects strangers', () => {
    expect(isBlockReason('manual')).toBe(true);
    expect(isBlockReason('fraud_suspect')).toBe(true);
    expect(isBlockReason('bogus_reason')).toBe(false);
    expect(isBlockReason(7)).toBe(false);
  });
});

describe('parseBlockReason', () => {
  it('accepts a known reason', () => {
    const result = parseBlockReason('terms_violation');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBe('terms_violation');
    }
  });

  it('rejects an unknown reason', () => {
    const result = parseBlockReason('made_up');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('accounts.block_reason.invalid');
    }
  });
});
