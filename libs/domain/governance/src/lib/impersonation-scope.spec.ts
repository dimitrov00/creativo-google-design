import { describe, expect, it } from 'vitest';
import {
  isImpersonationScope,
  parseImpersonationScope,
} from './impersonation-scope';

describe('parseImpersonationScope', () => {
  it('accepts "read"', () => {
    const result = parseImpersonationScope('read');
    expect(result.isSuccess()).toBe(true);
  });

  it('accepts "write"', () => {
    const result = parseImpersonationScope('write');
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an unknown scope', () => {
    const result = parseImpersonationScope('admin');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('governance.impersonation_scope.invalid');
    }
  });
});

describe('isImpersonationScope', () => {
  it('narrows valid values', () => {
    expect(isImpersonationScope('read')).toBe(true);
    expect(isImpersonationScope('write')).toBe(true);
  });

  it('rejects non-string / unknown values', () => {
    expect(isImpersonationScope('full')).toBe(false);
    expect(isImpersonationScope(1)).toBe(false);
  });
});
