import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from '@core/errors';
import {
  ImpersonationScope,
  parseImpersonationScope,
} from './impersonation-scope.data';

describe('ImpersonationScope', () => {
  it('keeps the stored scope strings, upper-snaked', () => {
    expect(Object.values(ImpersonationScope)).toEqual(['READ', 'WRITE']);
  });

  it('parseImpersonationScope accepts a known scope', () => {
    expect(parseImpersonationScope('WRITE')).toEqual({
      ok: true,
      value: ImpersonationScope.Write,
    });
    expect(parseImpersonationScope('READ')).toEqual({
      ok: true,
      value: ImpersonationScope.Read,
    });
  });

  it('parseImpersonationScope refuses a stranger with the governance code', () => {
    for (const raw of ['root', 'read', 'admin']) {
      expect(parseImpersonationScope(raw)).toEqual({
        ok: false,
        error: {
          errorCode: GovernanceErrorCode.ImpersonationScopeInvalid,
          attempted: raw,
        },
      });
    }
  });
});
