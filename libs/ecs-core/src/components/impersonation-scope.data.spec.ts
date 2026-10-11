import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from '@core/primitives';
import {
  IMPERSONATION_SCOPES,
  ImpersonationScope,
  isImpersonationScope,
  parseImpersonationScope,
} from './impersonation-scope.data';

describe('ImpersonationScope', () => {
  it('keeps the stored scope strings, upper-snaked', () => {
    expect([...IMPERSONATION_SCOPES]).toEqual(['READ', 'WRITE']);
  });

  it('isImpersonationScope narrows known scopes and rejects strangers', () => {
    expect(isImpersonationScope('READ')).toBe(true);
    expect(isImpersonationScope('WRITE')).toBe(true);
    expect(isImpersonationScope('read')).toBe(false);
    expect(isImpersonationScope('admin')).toBe(false);
    expect(isImpersonationScope(1)).toBe(false);
  });

  it('parseImpersonationScope accepts a known scope', () => {
    expect(parseImpersonationScope('WRITE')).toEqual({
      ok: true,
      value: ImpersonationScope.Write,
    });
  });

  it('parseImpersonationScope refuses a stranger with the governance code', () => {
    expect(parseImpersonationScope('root')).toEqual({
      ok: false,
      error: {
        errorCode: GovernanceErrorCode.ImpersonationScopeInvalid,
        attempted: 'root',
      },
    });
  });
});
