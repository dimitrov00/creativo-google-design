import { describe, expect, it } from 'vitest';
import { ImpersonationSessionId, UserId, UtcEpochMs } from '@core/primitives';
import { FIXTURE_NOW_UTC_MS } from '@core/testing';
import { AuthClaims, AuthStage } from './auth-claims.data';
import { ImpersonationScope } from './impersonation-scope.data';
import { ReadAsClaim, ReadAsClaims } from './read-as-claims.data';
import { Role } from './role.data';

/*
 * The read-as facts on a token (OR-24, docs/designs/support-read-as.md):
 * four claims beside the target's own, spelled once, read defensively.
 */

const EXPIRES = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 15 * 60_000);

const CLAIMS: ReadAsClaims = {
  readAsSessionId: ImpersonationSessionId.of('imp-1'),
  readAsByUserId: UserId.of('u-support'),
  readAsScope: ImpersonationScope.Read,
  readAsExpiresAtUtcMs: EXPIRES,
};

describe('ReadAsClaims', () => {
  it('spells the four claims as the rules read them — imp, impBy, impScope, impExp', () => {
    expect(ReadAsClaims.toToken(CLAIMS)).toEqual({
      imp: 'imp-1',
      impBy: 'u-support',
      impScope: 'READ',
      impExp: EXPIRES,
    });
    expect(Object.values(ReadAsClaim)).toEqual([
      'imp',
      'impBy',
      'impScope',
      'impExp',
    ]);
  });

  it('reads back what it spelled, beside the target’s own claims, which it leaves alone', () => {
    const bag = {
      ...AuthClaims.toToken({
        tenantId: null,
        authStage: AuthStage.Active,
        roles: [Role.Admin],
      }),
      ...ReadAsClaims.toToken(CLAIMS),
    };
    expect(ReadAsClaims.fromToken(bag)).toEqual(CLAIMS);
    expect(ReadAsClaims.claimed(bag)).toBe(true);
    expect(AuthClaims.fromToken(bag).roles).toEqual(['admin']);
  });

  it('is absent on a plain session', () => {
    const plain = { stage: 'active', roles: ['client'] };
    expect(ReadAsClaims.claimed(plain)).toBe(false);
    expect(ReadAsClaims.fromToken(plain)).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['an unknown scope', { impScope: 'ADMIN' }],
    ['an expiry that is no number', { impExp: '1700000000000' }],
    ['a blank session id', { imp: '' }],
    ['no support account', { impBy: 42 }],
  ])(
    'claims a read-as whose claims do not read — %s — so the edge ends it rather than reading it as a plain session',
    (_case, broken) => {
      const bag = { ...ReadAsClaims.toToken(CLAIMS), ...broken };
      expect(ReadAsClaims.claimed(bag)).toBe(true);
      expect(ReadAsClaims.fromToken(bag)).toBeNull();
    },
  );

  it('is live strictly before its expiry, and over from it on', () => {
    expect(ReadAsClaims.isLive(CLAIMS, UtcEpochMs.plusMs(EXPIRES, -1))).toBe(
      true,
    );
    expect(ReadAsClaims.isLive(CLAIMS, EXPIRES)).toBe(false);
    expect(ReadAsClaims.isLive(CLAIMS, UtcEpochMs.plusMs(EXPIRES, 1))).toBe(
      false,
    );
  });
});
