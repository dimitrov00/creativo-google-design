import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AuthClaims, Principal, Role } from '@core/components';
import { TenantId, UserId } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import {
  GuestGuardSystem,
  type LatchedVerdict,
  SettledVerdict,
} from './guest-guard.system';

/*
 * The cases of libs/application/identity/src/lib/flow/guest-guard.spec.ts,
 * COPIED and re-targeted: `classify` → `GuestGuardSystem.classify`,
 * `latchSettledPrincipal` → `GuestGuardSystem.latch`, the legacy
 * `activePrincipal`/`onboardingPrincipal` factories → `Principal.fromClaims`.
 * The class spec keeps running against its shim.
 */

const UID = UserId.of('user_1');
const TENANT = TenantId.of('creativo');

const onboarding = Principal.fromClaims({
  userId: UID,
  claims: AuthClaims.onboarding(TENANT),
});
const client = Principal.fromClaims({
  userId: UID,
  claims: unwrapOk(AuthClaims.active(TENANT, [Role.Client])),
});
const staff = Principal.fromClaims({
  userId: UID,
  claims: unwrapOk(AuthClaims.active(TENANT, [Role.Barber])),
});

describe('GuestGuardSystem.classify', () => {
  it('is loading with no principal observed yet', () => {
    expect(GuestGuardSystem.classify(null)).toBe(SettledVerdict.Loading);
  });

  it('mirrors the principal kind once observed', () => {
    expect(GuestGuardSystem.classify(Principal.anonymous())).toBe(
      SettledVerdict.Anonymous,
    );
    expect(GuestGuardSystem.classify(onboarding)).toBe(
      SettledVerdict.Onboarding,
    );
    expect(GuestGuardSystem.classify(client)).toBe(SettledVerdict.Active);
  });

  it('reads a staff principal as active too — the guard only asks whether the account is finished', () => {
    expect(GuestGuardSystem.classify(staff)).toBe(SettledVerdict.Active);
  });
});

describe('GuestGuardSystem.latch', () => {
  it('freezes the first settled (non-loading) verdict', () => {
    let latched: LatchedVerdict | null = null;
    latched = GuestGuardSystem.latch(latched, SettledVerdict.Onboarding);
    expect(latched).toBe(SettledVerdict.Onboarding);
  });

  it('never yanks the user once latched, even if the live verdict flips to active mid-flow', () => {
    let latched: LatchedVerdict | null = null;
    latched = GuestGuardSystem.latch(latched, SettledVerdict.Onboarding);
    // Claims flip onboarding -> active while the user is mid-flow — the
    // latch must NOT follow.
    latched = GuestGuardSystem.latch(latched, SettledVerdict.Active);
    expect(latched).toBe(SettledVerdict.Onboarding);
  });

  it('stays unresolved while nothing has settled yet', () => {
    let latched: LatchedVerdict | null = null;
    latched = GuestGuardSystem.latch(latched, SettledVerdict.Loading);
    expect(latched).toBeNull();
  });

  it('only re-decides once the caller resets to a fresh (null) latch', () => {
    let latched: LatchedVerdict | null = null;
    latched = GuestGuardSystem.latch(latched, SettledVerdict.Active);
    expect(latched).toBe(SettledVerdict.Active);

    // A fresh mount (new page load) resets the held ref to null.
    latched = null;
    latched = GuestGuardSystem.latch(latched, SettledVerdict.Onboarding);
    expect(latched).toBe(SettledVerdict.Onboarding);
  });
});

describe('GuestGuardSystem properties', () => {
  const verdicts = [
    SettledVerdict.Loading,
    SettledVerdict.Anonymous,
    SettledVerdict.Onboarding,
    SettledVerdict.Active,
  ] as const;

  it('the latch keeps the first settled verdict of any live sequence', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...verdicts)), (live) => {
        let latched: LatchedVerdict | null = null;
        for (const verdict of live) {
          latched = GuestGuardSystem.latch(latched, verdict);
        }
        const first = live.find((v) => v !== SettledVerdict.Loading) ?? null;
        expect(latched).toBe(first);
      }),
    );
  });
});

describe('GuestGuardSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const principal = deepFreeze({ ...client });
    const once = GuestGuardSystem.classify(principal);
    const twice = GuestGuardSystem.classify(principal);
    expect(twice).toBe(once);
    expect(principal).toEqual(client);
    expect(
      GuestGuardSystem.latch(SettledVerdict.Anonymous, SettledVerdict.Active),
    ).toBe(
      GuestGuardSystem.latch(SettledVerdict.Anonymous, SettledVerdict.Active),
    );
  });
});
