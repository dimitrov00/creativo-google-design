import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AuthClaims,
  type Principal,
  Principal as P,
  Role,
} from '@core/components';
import { TenantId, UserId } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import {
  AccessTarget,
  AccessVerdict,
  REFRESH_BACKOFF_MS,
  RouteGate,
  SessionAccessSystem,
  SessionReadiness,
  type SessionReadinessState,
} from './session-access.system';

/*
 * The cases of the legacy identity application lib's
 * `ensure-session-ready.use-case.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED and re-targeted:
 * the use case's loop (observe → refresh on the backoff → observe) is driven
 * here by `SessionAccessSystem.readiness` over the same principal sequences,
 * and the refresh count is the number of `REFRESH` steps taken. Then the four
 * route guards of apps/web/src/app/guards/* as decisions
 * (`home.guard.spec.ts`'s three cases copied).
 */

const UID = UserId.of('user_1');
const TENANT = TenantId.of('creativo');

const anonymous = P.anonymous();
const onboarding = P.fromClaims({
  userId: UID,
  claims: AuthClaims.onboarding(TENANT),
});
const client = P.fromClaims({
  userId: UID,
  claims: unwrapOk(AuthClaims.active(TENANT, [Role.Client])),
});
const staff = P.fromClaims({
  userId: UID,
  claims: unwrapOk(AuthClaims.active(TENANT, [Role.Barber, Role.Admin])),
});

/**
 * The legacy use case's loop, with the decisions taken from the system: the
 * gateway answers `principals[min(i, last)]` after `i` refreshes.
 */
function runLoop(principals: readonly Principal[]): {
  principal: Principal;
  refreshCount: number;
  delays: readonly number[];
} {
  const observe = (i: number) =>
    principals[Math.min(i, principals.length - 1)] as Principal;
  let refreshCount = 0;
  const delays: number[] = [];
  let principal = observe(0);
  for (;;) {
    const step: SessionReadinessState = SessionAccessSystem.readiness(
      principal,
      refreshCount,
    );
    if (step.sessionReadiness !== SessionReadiness.Refresh) break;
    delays.push(step.delayMs);
    refreshCount++;
    principal = observe(refreshCount);
  }
  return { principal, refreshCount, delays };
}

describe('SessionAccessSystem.readiness (ensure-session-ready.use-case.spec.ts)', () => {
  it('returns immediately when already active — no refresh needed', () => {
    const run = runLoop([client]);
    expect(run.principal.principalKind).toBe(client.principalKind);
    expect(run.refreshCount).toBe(0);
  });

  it('retries refreshToken until the claim flips to active', () => {
    const run = runLoop([onboarding, onboarding, client]);
    expect(run.principal).toEqual(client);
    expect(run.refreshCount).toBe(2);
  });

  it('gives up after exhausting the fixed backoff schedule, still onboarding', () => {
    const run = runLoop([onboarding]);
    expect(run.principal).toEqual(onboarding);
    expect(run.refreshCount).toBe(REFRESH_BACKOFF_MS.length);
    expect(run.delays).toEqual(REFRESH_BACKOFF_MS);
    expect(SessionAccessSystem.readiness(onboarding, 6)).toEqual({
      sessionReadiness: SessionReadiness.Exhausted,
    });
  });

  it('settles at once on an anonymous first observation, but keeps refreshing one that went anonymous mid-loop', () => {
    expect(SessionAccessSystem.readiness(anonymous, 0).sessionReadiness).toBe(
      SessionReadiness.Ready,
    );
    expect(SessionAccessSystem.readiness(anonymous, 1)).toEqual({
      sessionReadiness: SessionReadiness.Refresh,
      delayMs: 200,
    });
    expect(SessionAccessSystem.readiness(staff, 3).sessionReadiness).toBe(
      SessionReadiness.Ready,
    );
  });
});

describe('SessionAccessSystem.decide (apps/web/src/app/guards/*)', () => {
  const active = { routeGate: RouteGate.Active } as const;
  const signedIn = { routeGate: RouteGate.SignedIn } as const;
  const home = (standalone: boolean) =>
    ({ routeGate: RouteGate.Home, standalone }) as const;
  const roles = (...required: Role[]) =>
    ({ routeGate: RouteGate.Roles, roles: required }) as const;

  it('active gate: lets an active principal in, sends onboarding to /onboarding and anonymous to /auth with the return URL', () => {
    expect(SessionAccessSystem.decide(client, active)).toEqual({
      accessVerdict: AccessVerdict.Allow,
    });
    expect(SessionAccessSystem.decide(staff, active).accessVerdict).toBe(
      AccessVerdict.Allow,
    );
    expect(SessionAccessSystem.decide(onboarding, active)).toEqual({
      accessVerdict: AccessVerdict.Redirect,
      to: AccessTarget.Onboarding,
      keepReturnUrl: false,
    });
    expect(SessionAccessSystem.decide(anonymous, active)).toEqual({
      accessVerdict: AccessVerdict.Redirect,
      to: AccessTarget.Auth,
      keepReturnUrl: true,
    });
  });

  it('signed-in gate (anonGuard): only bars anonymous visitors', () => {
    expect(SessionAccessSystem.decide(anonymous, signedIn)).toEqual({
      accessVerdict: AccessVerdict.Redirect,
      to: AccessTarget.Auth,
      keepReturnUrl: false,
    });
    expect(SessionAccessSystem.decide(onboarding, signedIn).accessVerdict).toBe(
      AccessVerdict.Allow,
    );
    expect(SessionAccessSystem.decide(client, signedIn).accessVerdict).toBe(
      AccessVerdict.Allow,
    );
  });

  it('allows a non-standalone visitor through regardless of principal', () => {
    expect(SessionAccessSystem.decide(client, home(false)).accessVerdict).toBe(
      AccessVerdict.Allow,
    );
  });

  it('allows a standalone-launch anonymous visitor through', () => {
    expect(
      SessionAccessSystem.decide(anonymous, home(true)).accessVerdict,
    ).toBe(AccessVerdict.Allow);
  });

  it('redirects a standalone-launch active visitor to /account', () => {
    expect(SessionAccessSystem.decide(client, home(true))).toEqual({
      accessVerdict: AccessVerdict.Redirect,
      to: AccessTarget.Account,
      keepReturnUrl: false,
    });
  });

  it('roles gate: any listed role lets in, anything else is /forbidden — never a bounce through /auth', () => {
    expect(
      SessionAccessSystem.decide(staff, roles(Role.Admin, Role.Sysadmin))
        .accessVerdict,
    ).toBe(AccessVerdict.Allow);
    expect(SessionAccessSystem.decide(client, roles(Role.Admin))).toEqual({
      accessVerdict: AccessVerdict.Redirect,
      to: AccessTarget.Forbidden,
      keepReturnUrl: false,
    });
    expect(
      SessionAccessSystem.decide(onboarding, roles(Role.Client)).accessVerdict,
    ).toBe(AccessVerdict.Redirect);
  });
});

describe('SessionAccessSystem properties', () => {
  it('never refreshes more often than the schedule, and only ever settles on an active principal after a refresh', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(anonymous, onboarding, client, staff), {
          minLength: 1,
          maxLength: 9,
        }),
        (principals) => {
          const run = runLoop(principals);
          expect(run.refreshCount).toBeLessThanOrEqual(
            REFRESH_BACKOFF_MS.length,
          );
          if (
            run.refreshCount > 0 &&
            run.refreshCount < REFRESH_BACKOFF_MS.length
          ) {
            expect(P.isActive(run.principal)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('SessionAccessSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const principal = deepFreeze({ ...staff });
    const gate = deepFreeze({
      routeGate: RouteGate.Roles,
      roles: [Role.Admin],
    } as const);
    const run = () => ({
      decision: SessionAccessSystem.decide(principal, gate),
      readiness: SessionAccessSystem.readiness(principal, 2),
    });
    expect(run()).toEqual(run());
    expect(principal).toEqual(staff);
  });
});
