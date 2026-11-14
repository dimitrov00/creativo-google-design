import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AccessTarget,
  AccessVerdict,
  AuthClaims,
  type Principal,
  Principal as P,
  Role,
  type RouteCapability,
  RouteGate,
  SessionReadiness,
  type SessionReadinessState,
  StaffPermissions,
} from '@core/components';
import {
  AccessScope,
  StaffCapability,
  TenantId,
  UserId,
} from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import {
  REFRESH_BACKOFF_MS,
  SessionAccessSystem,
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
 * The session-ready loop (observe → refresh on the backoff → observe), each
 * step decided by `SessionAccessSystem.readiness`: the gateway answers
 * `principals[min(i, last)]` after `i` refreshes.
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

describe('SessionAccessSystem.decide — the capability gate (staff permissions P8)', () => {
  const FORBIDDEN = {
    accessVerdict: AccessVerdict.Redirect,
    to: AccessTarget.Forbidden,
    keepReturnUrl: false,
  };
  const analyticsOwn: RouteCapability = {
    staffCapability: StaffCapability.Analytics,
    accessScope: AccessScope.Own,
  };
  const analyticsAll: RouteCapability = {
    staffCapability: StaffCapability.Analytics,
    accessScope: AccessScope.All,
  };
  const gate = (
    storedRoles: readonly Role[],
    routeCapabilities: readonly RouteCapability[],
    stored: Record<string, unknown> = {},
  ) =>
    ({
      routeGate: RouteGate.Capability,
      routeCapabilities,
      storedRoles,
      permissions: StaffPermissions.read(stored),
    }) as const;
  const verdict = (
    storedRoles: readonly Role[],
    routeCapabilities: readonly RouteCapability[],
    stored: Record<string, unknown> = {},
  ) =>
    SessionAccessSystem.decide(
      staff,
      gate(storedRoles, routeCapabilities, stored),
    ).accessVerdict;

  it('opens on the standard: a barber reaches their own analytics, the admin everyone’s, nobody else any', () => {
    expect(verdict([Role.Barber], [analyticsOwn])).toBe(AccessVerdict.Allow);
    expect(verdict([Role.Admin], [analyticsOwn])).toBe(AccessVerdict.Allow);
    for (const role of [
      Role.Receptionist,
      Role.ContentManager,
      Role.Sysadmin,
      Role.Client,
    ]) {
      expect(
        SessionAccessSystem.decide(staff, gate([role], [analyticsOwn])),
        role,
      ).toEqual(FORBIDDEN);
    }
  });

  it('a route that shows everyone’s needs everyone: own is not enough', () => {
    expect(
      SessionAccessSystem.decide(staff, gate([Role.Barber], [analyticsAll])),
    ).toEqual(FORBIDDEN);
    expect(verdict([Role.Admin], [analyticsAll])).toBe(AccessVerdict.Allow);
    expect(
      verdict([Role.Barber], [analyticsAll], { barberAnalyticsScope: 'ALL' }),
    ).toBe(AccessVerdict.Allow);
  });

  it('follows the owner’s cells: a narrowed level is turned away, a widened one let in', () => {
    expect(
      SessionAccessSystem.decide(
        staff,
        gate([Role.Barber], [analyticsOwn], { barberAnalyticsScope: 'NONE' }),
      ),
    ).toEqual(FORBIDDEN);
    expect(
      verdict([Role.Receptionist], [analyticsOwn], {
        receptionistAnalyticsScope: 'ALL',
      }),
    ).toBe(AccessVerdict.Allow);
    // The owner is never turned away, whatever is stored.
    expect(
      verdict([Role.Admin], [analyticsAll], { barberAnalyticsScope: 'NONE' }),
    ).toBe(AccessVerdict.Allow);
  });

  it('any one capability of the route opens it; none listed opens nothing', () => {
    const profilesAll: RouteCapability = {
      staffCapability: StaffCapability.TeamProfiles,
      accessScope: AccessScope.All,
    };
    const manage: RouteCapability = {
      staffCapability: StaffCapability.TeamManage,
      accessScope: AccessScope.All,
    };
    // A content editor edits every profile and does not manage the team.
    expect(verdict([Role.ContentManager], [manage, profilesAll])).toBe(
      AccessVerdict.Allow,
    );
    expect(
      SessionAccessSystem.decide(staff, gate([Role.ContentManager], [manage])),
    ).toEqual(FORBIDDEN);
    expect(SessionAccessSystem.decide(staff, gate([Role.Admin], []))).toEqual(
      FORBIDDEN,
    );
  });

  it('reads the STORED roles it is handed, not the token’s — and turns away a principal that is not active', () => {
    // The token still says barber + admin; the stored account is a client's.
    expect(
      SessionAccessSystem.decide(staff, gate([Role.Client], [analyticsOwn])),
    ).toEqual(FORBIDDEN);
    for (const principal of [anonymous, onboarding]) {
      expect(
        SessionAccessSystem.decide(
          principal,
          gate([Role.Admin], [analyticsOwn]),
        ),
      ).toEqual(FORBIDDEN);
    }
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
    const capability = deepFreeze({
      routeGate: RouteGate.Capability,
      routeCapabilities: [
        {
          staffCapability: StaffCapability.Analytics,
          accessScope: AccessScope.Own,
        },
      ],
      storedRoles: [Role.Barber],
      permissions: StaffPermissions.read({ barberAnalyticsScope: 'ALL' }),
    } as const);
    const run = () => ({
      decision: SessionAccessSystem.decide(principal, gate),
      capability: SessionAccessSystem.decide(principal, capability),
      readiness: SessionAccessSystem.readiness(principal, 2),
    });
    expect(run()).toEqual(run());
    expect(principal).toEqual(staff);
  });
});
