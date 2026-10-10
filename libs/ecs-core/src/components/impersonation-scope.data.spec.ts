import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from './governance-errors.data';
import {
  IMPERSONATION_SCOPES,
  ImpersonationScope,
  isImpersonationScope,
  parseImpersonationScope,
} from './impersonation-scope.data';

describe('ImpersonationScope', () => {
  it('keeps the stored scope strings', () => {
    expect([...IMPERSONATION_SCOPES]).toEqual(['read', 'write']);
  });

  it('isImpersonationScope narrows known scopes and rejects strangers', () => {
    expect(isImpersonationScope('read')).toBe(true);
    expect(isImpersonationScope('write')).toBe(true);
    expect(isImpersonationScope('admin')).toBe(false);
    expect(isImpersonationScope(1)).toBe(false);
  });

  it('parseImpersonationScope accepts a known scope', () => {
    expect(parseImpersonationScope('write')).toEqual({
      ok: true,
      value: ImpersonationScope.Write,
    });
  });

  it('parseImpersonationScope refuses a stranger with the governance code', () => {
    expect(parseImpersonationScope('root')).toEqual({
      ok: false,
      error: {
        code: GovernanceErrorCode.ImpersonationScopeInvalid,
        attempted: 'root',
      },
    });
  });
});
