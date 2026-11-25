import {
  type AccessDecision,
  AccessTarget,
  AccessVerdict,
  HomeDestination,
  type HomeLanding,
  Principal,
  PrincipalKind,
  RouteCapabilities,
  type RouteCapability,
  RouteGate,
  type RouteGateRule,
  Roles,
  SessionReadiness,
  type SessionReadinessState,
  type StaffPermissions,
} from '@core/components';
import { AccessScope, type BarberId } from '@core/primitives';
import type { PrincipalTag } from './guest-guard.system';
import { StaffAccessSystem } from './staff-access.system';

/**
 * SessionAccessSystem — who may enter which route, where a person lands,
 * and when a session is ready to be asked (blueprint §2.8). The pure halves
 * of `apps/web/src/app/guards/*` (`activeGuard`, `anonGuard`, `homeGuard`,
 * `rolesGuard`), of the web's landing (`HomeLandingService`) and of
 * `EnsureSessionReadyUseCase`'s refresh backoff (the
 * legacy identity application lib's `ensure-session-ready.use-case.ts`,
 * deleted in Phase 4b).
 *
 * The guards keep the router and the gateway; this decides. The backoff
 * keeps the timer and the token refresh; this says whether to wait, how
 * long, and when to stop.
 */

/**
 * The refresh schedule right after sign-in or registration — v2's
 * `routerAuth.ensureReady()` backoff verbatim: freshly minted claims can lag
 * a beat behind the ID token the client already holds.
 */
export const REFRESH_BACKOFF_MS: readonly number[] = [
  0, 200, 400, 700, 1200, 1600,
];

const ALLOW: AccessDecision = { accessVerdict: AccessVerdict.Allow };

function redirect(to: AccessTarget, keepReturnUrl: boolean): AccessDecision {
  return { accessVerdict: AccessVerdict.Redirect, to, keepReturnUrl };
}

export const SessionAccessSystem = {
  /**
   * The session-ready loop, one observation at a time. `refreshesDone` is
   * how many refreshes ran before this observation (`0` for the first).
   * The first observation settles on anything but `ONBOARDING`; after a
   * refresh only an active principal settles (a principal that went
   * anonymous mid-loop keeps refreshing, as the legacy loop did); once the
   * schedule is spent the loop stops with the principal as it stands.
   */
  readiness(
    principal: PrincipalTag,
    refreshesDone: number,
  ): SessionReadinessState {
    if (refreshesDone === 0) {
      if (principal.principalKind !== PrincipalKind.Onboarding) {
        return { sessionReadiness: SessionReadiness.Ready };
      }
    } else if (
      principal.principalKind === PrincipalKind.Client ||
      principal.principalKind === PrincipalKind.Staff
    ) {
      return { sessionReadiness: SessionReadiness.Ready };
    }
    if (refreshesDone >= REFRESH_BACKOFF_MS.length) {
      return { sessionReadiness: SessionReadiness.Exhausted };
    }
    return {
      sessionReadiness: SessionReadiness.Refresh,
      delayMs: REFRESH_BACKOFF_MS[refreshesDone] as number,
    };
  },

  /**
   * Whether a role set opens a route the owner's permissions decide: its
   * levels reach far enough for any ONE of the route's capabilities. What
   * the gate decides on, and what a way in to the route is shown by — so
   * the two cannot disagree.
   */
  opens(
    routeCapabilities: readonly RouteCapability[],
    permissions: StaffPermissions,
    storedRoles: readonly string[],
  ): boolean {
    for (let i = 0; i < routeCapabilities.length; i++) {
      const need = routeCapabilities[i] as RouteCapability;
      const scope = StaffAccessSystem.scopeOf(
        permissions,
        need.staffCapability,
        storedRoles,
      );
      if (
        scope === AccessScope.All ||
        (scope === AccessScope.Own && need.accessScope === AccessScope.Own)
      ) {
        return true;
      }
    }
    return false;
  },

  /**
   * Whether the person has a page of their own to open — «Моят профил»
   * (`/staff/profile`): an account linked to a barber record, whose levels
   * open the route by the gate's own rule (`RouteCapabilities.OwnProfile`
   * through {@link SessionAccessSystem.opens}). The menu's row and every
   * other way in ask this, so none shows for someone the page has no record
   * for (the owner with no chair of their own) or would turn away.
   */
  opensOwnProfile(
    linkedBarberId: BarberId | null,
    permissions: StaffPermissions,
    storedRoles: readonly string[],
  ): boolean {
    return (
      linkedBarberId !== null &&
      SessionAccessSystem.opens(
        RouteCapabilities.OwnProfile,
        permissions,
        storedRoles,
      )
    );
  },

  /**
   * WHERE A PERSON LANDS with no link to follow (owner rulings 2026-11-25,
   * Q3 of the role-aware homes brief): the home of their main job, read off
   * the token's roles — whoever works the book on the schedule (the admin
   * with no chair, the sysadmin and the receptionist included), a content
   * manager who does not on the programs, everyone else on their account.
   * Each is a route the same roles open (`decide`'s `ROLES` and `ACTIVE`
   * gates), so a landing is never `/forbidden`; a principal that is not
   * active has no home of its own and gets the account, which sends it on.
   */
  homeOf(principal: Principal): HomeDestination {
    if (Principal.hasAnyRole(principal, Roles.BOOK)) {
      return HomeDestination.Schedule;
    }
    if (Principal.hasAnyRole(principal, Roles.CATALOG)) {
      return HomeDestination.Programs;
    }
    return HomeDestination.Account;
  },

  /**
   * The landing whole (Q4): the home, and on the schedule the person's own
   * chair — `linkedBarberId`, the account's link to a barber record, read
   * from the account document. No link (an admin with no chair, a barber
   * role with no record, a barber whose period was closed) is every chair.
   * Off the schedule there is no chair to open on.
   */
  landingOf(
    principal: Principal,
    linkedBarberId: BarberId | null,
  ): HomeLanding {
    const homeDestination = SessionAccessSystem.homeOf(principal);
    return {
      homeDestination,
      homeBarberId:
        homeDestination === HomeDestination.Schedule ? linkedBarberId : null,
    };
  },

  /**
   * `/`, THE DISPATCHER: whether a visit to the root lands somewhere, and
   * where. An installed-app launch (`standalone`) by an active principal
   * lands on their home; anyone else — a browser tab, a visitor, a session
   * not yet active — sees the landing page (`null`). Whether a signed-in
   * staff member's browser tab should also skip it is the brief's open Q5.
   */
  rootLandingOf(
    principal: Principal,
    standalone: boolean,
  ): HomeDestination | null {
    return standalone && Principal.isActive(principal)
      ? SessionAccessSystem.homeOf(principal)
      : null;
  },

  /** The route decision for a settled principal. */
  decide(principal: Principal, gate: RouteGateRule): AccessDecision {
    switch (gate.routeGate) {
      case RouteGate.Active:
        if (Principal.isActive(principal)) return ALLOW;
        return principal.principalKind === PrincipalKind.Onboarding
          ? redirect(AccessTarget.Onboarding, false)
          : redirect(AccessTarget.Auth, true);
      case RouteGate.SignedIn:
        return principal.principalKind === PrincipalKind.Anonymous
          ? redirect(AccessTarget.Auth, false)
          : ALLOW;
      case RouteGate.Roles:
        return Principal.hasAnyRole(principal, gate.roles)
          ? ALLOW
          : redirect(AccessTarget.Forbidden, false);
      default: {
        // The owner's permissions decide (staff permissions P8): the route
        // opens when the account's levels reach far enough for any one of
        // its capabilities. A principal that is not active holds nothing.
        return Principal.isActive(principal) &&
          SessionAccessSystem.opens(
            gate.routeCapabilities,
            gate.permissions,
            gate.storedRoles,
          )
          ? ALLOW
          : redirect(AccessTarget.Forbidden, false);
      }
    }
  },
} as const;
