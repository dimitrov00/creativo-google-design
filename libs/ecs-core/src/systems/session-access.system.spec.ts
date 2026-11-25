import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AccessTarget,
  AccessVerdict,
  AuthClaims,
  HomeDestination,
  type Principal,
  Principal as P,
  Role,
  RouteCapabilities,
  type RouteCapability,
  RouteGate,
  Roles,
  SessionReadiness,
  type SessionReadinessState,
  StaffPermissions,
} from '@core/components';
import {
  AccessScope,
  BarberId,
  StaffCapability,
  Tag,
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
 * and the refresh count is the number of `REFRESH` steps taken. Then the
 * route guards of apps/web/src/app/guards/* as decisions, and where a person
 * lands (owner rulings 2026-11-25).
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

  it('RouteCapabilities: what opens «Анализи» and «Екип», read by the gate and by every way in', () => {
    const opens = (
      route: readonly RouteCapability[],
      roles: readonly Role[],
      stored: Record<string, unknown> = {},
    ) => SessionAccessSystem.opens(route, StaffPermissions.read(stored), roles);

    // «Анализи»: a barber's own, the admin's everything.
    expect(opens(RouteCapabilities.Analytics, [Role.Barber])).toBe(true);
    expect(opens(RouteCapabilities.Analytics, [Role.Admin])).toBe(true);
    expect(opens(RouteCapabilities.Analytics, [Role.Receptionist])).toBe(false);

    // «Екип»: the admin, and a content editor for the profiles; not a barber
    // (own profile only) and not the front desk.
    expect(opens(RouteCapabilities.Team, [Role.Admin])).toBe(true);
    expect(opens(RouteCapabilities.Team, [Role.ContentManager])).toBe(true);
    expect(opens(RouteCapabilities.Team, [Role.Barber])).toBe(false);
    expect(opens(RouteCapabilities.Team, [Role.Receptionist])).toBe(false);
    // The owner lets the front desk manage the team.
    expect(
      opens(RouteCapabilities.Team, [Role.Receptionist], {
        receptionistTeamManageScope: 'ALL',
      }),
    ).toBe(true);
    // …and takes the profiles from the content editors.
    expect(
      opens(RouteCapabilities.Team, [Role.ContentManager], {
        contentManagerTeamProfilesScope: 'NONE',
      }),
    ).toBe(false);
    // «Моят профил»: whoever edits their own profile — a barber by default,
    // the content editor and the admin, who reach everyone's; not the front
    // desk, and not a barber the owner took their profile from.
    expect(opens(RouteCapabilities.OwnProfile, [Role.Barber])).toBe(true);
    expect(opens(RouteCapabilities.OwnProfile, [Role.ContentManager])).toBe(
      true,
    );
    expect(opens(RouteCapabilities.OwnProfile, [Role.Admin])).toBe(true);
    expect(opens(RouteCapabilities.OwnProfile, [Role.Receptionist])).toBe(
      false,
    );
    expect(
      opens(RouteCapabilities.OwnProfile, [Role.Barber], {
        barberTeamProfilesScope: 'NONE',
      }),
    ).toBe(false);
    // The gate and `opens` are one rule.
    for (const roles of [[Role.Barber], [Role.ContentManager], [Role.Admin]]) {
      expect(
        verdict(roles, RouteCapabilities.Team) === AccessVerdict.Allow,
      ).toBe(opens(RouteCapabilities.Team, roles));
    }
  });

  it('opensOwnProfile: a linked record AND the gate’s own rule — never one without the other', () => {
    const petar = BarberId.of('petar');
    const own = (
      linkedBarberId: BarberId | null,
      roles: readonly Role[],
      stored: Record<string, unknown> = {},
    ) =>
      SessionAccessSystem.opensOwnProfile(
        linkedBarberId,
        StaffPermissions.read(stored),
        roles,
      );

    // A barber linked to their record: their page opens.
    expect(own(petar, [Role.Barber])).toBe(true);
    // The owner with a chair of their own, too.
    expect(own(petar, [Role.Admin])).toBe(true);
    // The owner with no record of their own: everything, and no page.
    expect(own(null, [Role.Admin])).toBe(false);
    // A barber not linked (yet): the page has no record to show.
    expect(own(null, [Role.Barber])).toBe(false);
    // Linked, but the owner took the profile from barbers: the gate's no.
    expect(own(petar, [Role.Barber], { barberTeamProfilesScope: 'NONE' })).toBe(
      false,
    );
    // Linked at the front desk: the standard gives the desk no profile.
    expect(own(petar, [Role.Receptionist])).toBe(false);
    // Linked, it is exactly the route's gate.
    for (const roles of [
      [Role.Barber],
      [Role.Admin],
      [Role.ContentManager],
      [Role.Receptionist],
      [Role.Client],
    ]) {
      expect(own(petar, roles)).toBe(
        verdict(roles, RouteCapabilities.OwnProfile) === AccessVerdict.Allow,
      );
    }
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

describe('SessionAccessSystem — where a person lands (owner rulings 2026-11-25, Q3–Q4)', () => {
  const as = (...roles: Role[]): Principal =>
    P.fromClaims({
      userId: UID,
      claims: unwrapOk(AuthClaims.active(TENANT, roles)),
    });
  const IVAN = BarberId.of('ivan');

  it('lands each job on its home: the book on the schedule, the programs, else the account', () => {
    expect(SessionAccessSystem.homeOf(as(Role.Barber))).toBe(
      HomeDestination.Schedule,
    );
    expect(SessionAccessSystem.homeOf(as(Role.Barber, Role.Admin))).toBe(
      HomeDestination.Schedule,
    );
    expect(SessionAccessSystem.homeOf(as(Role.Receptionist))).toBe(
      HomeDestination.Schedule,
    );
    expect(SessionAccessSystem.homeOf(as(Role.ContentManager))).toBe(
      HomeDestination.Programs,
    );
    expect(
      SessionAccessSystem.homeOf(as(Role.Client, Role.ContentManager)),
    ).toBe(HomeDestination.Programs);
    expect(SessionAccessSystem.homeOf(as(Role.Client))).toBe(
      HomeDestination.Account,
    );
  });

  it('Q3’s quiet rows: an admin with no chair, the sysadmin and a content manager at the desk land on the schedule', () => {
    expect(SessionAccessSystem.landingOf(as(Role.Admin), null)).toEqual({
      homeDestination: HomeDestination.Schedule,
      homeBarberId: null,
    });
    expect(SessionAccessSystem.homeOf(as(Role.Sysadmin))).toBe(
      HomeDestination.Schedule,
    );
    expect(
      SessionAccessSystem.homeOf(as(Role.ContentManager, Role.Receptionist)),
    ).toBe(HomeDestination.Schedule);
  });

  it('Q4: the schedule opens on the person’s own chair when the account links one, every chair when not — and no chair off the schedule', () => {
    expect(
      SessionAccessSystem.landingOf(as(Role.Barber, Role.Admin), IVAN),
    ).toEqual({
      homeDestination: HomeDestination.Schedule,
      homeBarberId: IVAN,
    });
    expect(SessionAccessSystem.landingOf(as(Role.Barber), null)).toEqual({
      homeDestination: HomeDestination.Schedule,
      homeBarberId: null,
    });
    expect(SessionAccessSystem.landingOf(as(Role.Client), IVAN)).toEqual({
      homeDestination: HomeDestination.Account,
      homeBarberId: null,
    });
  });

  it('a session that is not active has no home of its own: the account, which sends it on', () => {
    expect(SessionAccessSystem.homeOf(anonymous)).toBe(HomeDestination.Account);
    expect(SessionAccessSystem.homeOf(onboarding)).toBe(
      HomeDestination.Account,
    );
  });

  it('every one of the 64 role sets lands on a route its own roles open — never /forbidden', () => {
    const all = Tag.values(Role);
    expect(all).toHaveLength(6);
    for (let mask = 1; mask < 1 << all.length; mask++) {
      const held = all.filter((_, i) => (mask & (1 << i)) !== 0);
      const principal = as(...held);
      const home = SessionAccessSystem.homeOf(principal);
      const gate =
        home === HomeDestination.Schedule
          ? ({ routeGate: RouteGate.Roles, roles: Roles.BOOK } as const)
          : home === HomeDestination.Programs
            ? ({ routeGate: RouteGate.Roles, roles: Roles.CATALOG } as const)
            : ({ routeGate: RouteGate.Active } as const);
      expect(
        SessionAccessSystem.decide(principal, gate).accessVerdict,
        held.join('+'),
      ).toBe(AccessVerdict.Allow);
    }
  });

  it('`/` dispatches only an installed-app launch by an active principal; a browser tab and a visitor see the landing page', () => {
    expect(SessionAccessSystem.rootLandingOf(staff, true)).toBe(
      HomeDestination.Schedule,
    );
    expect(SessionAccessSystem.rootLandingOf(client, true)).toBe(
      HomeDestination.Account,
    );
    expect(SessionAccessSystem.rootLandingOf(staff, false)).toBeNull();
    expect(SessionAccessSystem.rootLandingOf(anonymous, true)).toBeNull();
    expect(SessionAccessSystem.rootLandingOf(onboarding, true)).toBeNull();
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
      ownProfile: SessionAccessSystem.opensOwnProfile(
        BarberId.of('petar'),
        capability.permissions,
        capability.storedRoles,
      ),
      landing: SessionAccessSystem.landingOf(principal, BarberId.of('petar')),
      root: SessionAccessSystem.rootLandingOf(principal, true),
    });
    expect(run()).toEqual(run());
    expect(principal).toEqual(staff);
  });
});
