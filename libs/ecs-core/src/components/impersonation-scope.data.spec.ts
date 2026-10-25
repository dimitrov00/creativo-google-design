import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from '@core/errors';
import { ImpersonationScope } from './impersonation-scope.data';
import { ImpersonationLifecycle } from './impersonation-status.data';

describe('ImpersonationScope', () => {
  it('keeps the stored scope strings, upper-snaked', () => {
    expect(Object.values(ImpersonationScope)).toEqual(['READ', 'WRITE']);
  });

  it('parseImpersonationScope accepts a known scope', () => {
    expect(ImpersonationLifecycle.parseScope('WRITE')).toEqual({
      ok: true,
      value: ImpersonationScope.Write,
    });
    expect(ImpersonationLifecycle.parseScope('READ')).toEqual({
      ok: true,
      value: ImpersonationScope.Read,
    });
  });

  it('parseImpersonationScope refuses a stranger with the governance code', () => {
    for (const raw of ['root', 'read', 'admin']) {
      expect(ImpersonationLifecycle.parseScope(raw)).toEqual({
        ok: false,
        error: {
          errorCode: GovernanceErrorCode.ImpersonationScopeInvalid,
          attempted: raw,
        },
      });
    }
  });
});
