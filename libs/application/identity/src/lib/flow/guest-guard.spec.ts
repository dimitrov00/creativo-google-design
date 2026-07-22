import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import {
  PrincipalId,
  activePrincipal,
  onboardingPrincipal,
  roleFromPrimitive,
} from '@creativo/domain/identity';
import { classify, latchSettledPrincipal } from './guest-guard';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const UID = requiredValue(PrincipalId.create('user_1'));

describe('classify', () => {
  it('is loading with no principal observed yet', () => {
    expect(classify(null)).toBe('loading');
  });

  it('mirrors the principal kind once observed', () => {
    expect(classify({ kind: 'anonymous' })).toBe('anonymous');
    expect(classify(onboardingPrincipal(UID))).toBe('onboarding');
    expect(
      classify(
        requiredValue(activePrincipal(UID, [roleFromPrimitive('client')])),
      ),
    ).toBe('active');
  });
});

describe('latchSettledPrincipal', () => {
  it('freezes the first settled (non-loading) verdict', () => {
    let latched: 'anonymous' | 'onboarding' | 'active' | null = null;
    latched = latchSettledPrincipal(latched, 'onboarding');
    expect(latched).toBe('onboarding');
  });

  it('never yanks the user once latched, even if the live verdict flips to active mid-flow', () => {
    let latched: 'anonymous' | 'onboarding' | 'active' | null = null;
    latched = latchSettledPrincipal(latched, 'onboarding');
    // Claims flip onboarding -> active while the user is mid-flow (e.g. a
    // token refresh right after they finished onboarding elsewhere) — the
    // latch must NOT follow.
    latched = latchSettledPrincipal(latched, 'active');
    expect(latched).toBe('onboarding');
  });

  it('stays unresolved while nothing has settled yet', () => {
    let latched: 'anonymous' | 'onboarding' | 'active' | null = null;
    latched = latchSettledPrincipal(latched, 'loading');
    expect(latched).toBeNull();
  });

  it('only re-decides once the caller resets to a fresh (null) latch', () => {
    let latched: 'anonymous' | 'onboarding' | 'active' | null = null;
    latched = latchSettledPrincipal(latched, 'active');
    expect(latched).toBe('active');

    // A fresh mount (new page load) resets the held ref to null.
    latched = null;
    latched = latchSettledPrincipal(latched, 'onboarding');
    expect(latched).toBe('onboarding');
  });
});
